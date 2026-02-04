/* eslint-disable @typescript-eslint/member-ordering */
// NOTE: Member ordering warnings suppressed - methods are logically grouped by feature area
// rather than strictly by visibility/decorator for better code organization and readability

import fs from 'node:fs';
import path from 'node:path';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { Clone } from '@sinclair/typebox/value';
import pointer, { type JsonObject } from 'json-pointer';
import { formatISO, parseISO } from 'date-fns';
import { createCache } from 'async-cache-dedupe';
import { paths, components } from '@openapi';
import type { Prettify } from '@common/interfaces';
import { SERVICES } from '@common/constants';
import { enrichLogContext } from '@common/logger';
import { setSpanAttributes, withSpan } from '@common/tracing';
import { filesTreeGenerator, removeSchemaVersion } from '@common/utils';
import { ConfigRepository, ConfigRefResponse, ConfigSearchParams, SqlPaginationParams } from '../repositories/configRepository';
import { SchemaManager, schemasBasePath } from '../../schemas/models/schemaManager';
import type { EnvVar } from '../../schemas/models/types';
import { Config, SortOption } from './config';
import { Validator } from './configValidator';
import { ConfigNotFoundError, ConfigSchemaMismatchError, ConfigValidationError, ConfigVersionMismatchError } from './errors';
import { ConfigReference } from './configReference';
import { getConfigCacheKey, HashPropagationHelper } from './hashPropagationHelpers';
import type { ConfigFullMetadata, ConfigReference as ConfigReferenceType, ConfigStats, EnvVarWithValue } from './types';

type GetConfigOptions = Prettify<Omit<NonNullable<paths['/config']['get']['parameters']['query']>, 'sort'> & { sort?: SortOption[] }>;

type DefaultConfigToInsert = Parameters<ConfigManager['createConfig']>[0] & {
  refs: ConfigReference[];
  visited: boolean;
};

// Constants for configuration metadata
const MAX_RECURSION_DEPTH = 2;
const NOT_FOUND_INDEX = -1;

@injectable()
export class ConfigManager {
  private readonly fullConfigCache: ReturnType<typeof createCache>;

  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(ConfigRepository) private readonly configRepository: ConfigRepository,
    @inject(Validator) private readonly configValidator: Validator,
    @inject(HashPropagationHelper) private readonly hashPropagationHelper: HashPropagationHelper,
    @inject(SchemaManager) private readonly schemaManager: SchemaManager
  ) {
    // Initialize async-cache-dedupe for full config metadata
    this.fullConfigCache = createCache({
      ttl: 300, // 5 minutes in seconds
      storage: { type: 'memory' },
    });

    // Define cached function for full config metadata
    this.fullConfigCache.define('getMetadata', async ({ name, schemaId, version }: { name: string; schemaId: string; version?: number }) => {
      return this.generateFullConfigMetadata(name, schemaId, version);
    });
  }

  @withSpan()
  public async getConfig(name: string, schemaId: string, version?: number, shouldDereferenceConfig?: boolean): Promise<Config> {
    if (shouldDereferenceConfig !== true) {
      this.logger.debug('Retrieving config from the database with unresolved refs');
      const config = await this.configRepository.getConfig(name, schemaId, version);

      if (!config) {
        throw new ConfigNotFoundError('Config not found');
      }

      enrichLogContext({ resolvedConfigVersion: config.version });
      return config;
    }

    this.logger.debug('Retrieving config from the database with resolved refs');

    const res = await this.configRepository.getConfigRecursive(name, schemaId, version);
    if (!res) {
      throw new ConfigNotFoundError('Config not found');
    }

    enrichLogContext({ resolvedConfigVersion: res[0].version });

    const [config, refs] = res;

    if (refs.length > 0) {
      this.logger.debug({ refCount: refs.length, msg: 'Resolving refs for config' });
      setSpanAttributes({ refCount: refs.length });
      this.replaceRefs(config.config, refs);
    }

    return config;
  }

  @withSpan()
  public async getConfigs(options?: GetConfigOptions): Promise<{ configs: Config[]; totalCount: number }> {
    this.logger.debug('Preparing search params and retrieving configs from the database');

    const searchParams: ConfigSearchParams = {};
    let paginationParams: SqlPaginationParams = {};
    let sortParams: SortOption[] = [];
    if (options) {
      const { offset, limit, sort, ...querySearchParams } = options;
      paginationParams = { offset, limit };
      enrichLogContext({ offset, limit }, true);
      if (sort !== undefined) {
        sortParams = sort;
      }

      searchParams.configName = querySearchParams.config_name;
      searchParams.q = querySearchParams.q;
      searchParams.version = querySearchParams.version;
      searchParams.schemaId = querySearchParams.schema_id;
      if (querySearchParams.created_at_gt !== undefined) {
        searchParams.createdAtGt = parseISO(querySearchParams.created_at_gt);
      }
      if (querySearchParams.created_at_lt !== undefined) {
        searchParams.createdAtLt = parseISO(querySearchParams.created_at_lt);
      }
      searchParams.createdBy = querySearchParams.created_by;
    }

    return this.configRepository.getConfigs(searchParams, paginationParams, sortParams);
  }

  @withSpan()
  public async createConfig(config: Omit<components['schemas']['config'], 'createdAt' | 'createdBy' | 'isLatest'>): Promise<void> {
    this.logger.debug('Creating a new config');

    this.logger.debug('fetching latest config with same name for validations');
    const latestConfig = await this.configRepository.getConfig(config.configName, config.schemaId);

    await this.createConfigValidations(latestConfig, config);

    // Resolve all the references in the config
    const refs = this.listConfigRefs(config);
    const resolvedRefs = await this.configRepository.getAllConfigRefs(refs);

    // close so we keep the original config with the refs unresolved
    const resolvedConfig = Clone(config.config);
    this.replaceRefs(resolvedConfig, resolvedRefs);

    const [isValid, err] = await this.configValidator.isValid(config.schemaId, resolvedConfig);

    if (!isValid) {
      throw new ConfigValidationError(`The config is not valid: ${JSON.stringify(err)}`);
    }

    if (latestConfig !== undefined) {
      this.logger.debug('a config with the same name already exists, incrementing version');
      config.version++;
    }

    // Calculate Merkle hash: Hash = SHA256(Body + SortedListOf(DirectDependencyHashes))
    const hash = this.hashPropagationHelper.calculateConfigHash(config.config, refs, resolvedRefs);

    await this.configRepository.createConfig({ ...config, createdBy: 'TBD', refs, hash });
    enrichLogContext({ createdVersion: config.version }, true);

    // Propagate hash changes to all parent configs
    await this.propagateHashToParents(config.configName, config.schemaId, config.version);
  }

  @withSpan()
  private async createConfigValidations(
    latestConfig: Config | undefined,
    newConfig: Omit<components['schemas']['config'], 'createdAt' | 'createdBy' | 'isLatest'>
  ): Promise<void> {
    if (!latestConfig) {
      if (newConfig.version !== 1) {
        throw new ConfigVersionMismatchError('A new version of a config was submitted, when the config does not exist');
      }

      const versionLessSchemaId = removeSchemaVersion(newConfig.schemaId);
      const configsWithSameName = await this.configRepository.getConfigs({ configName: newConfig.configName });

      if (configsWithSameName.configs.some((config) => removeSchemaVersion(config.schemaId) !== versionLessSchemaId)) {
        throw new ConfigSchemaMismatchError('The schema of the config is not the same as the rest of the configs with the same name');
      }
    }

    if (latestConfig) {
      if (newConfig.version !== latestConfig.version) {
        throw new ConfigVersionMismatchError('The version of the config is not the next one in line');
      }

      if (newConfig.schemaId !== latestConfig.schemaId) {
        throw new ConfigSchemaMismatchError('The schema id of the config is not the same as the rest of the configs with the same name');
      }
    }
  }

  /**
   * Retrieves all the config references from the given config object.
   * @param config - The config object to retrieve the references from.
   * @returns An array of config references.
   * @throws {ConfigValidationError} If the config reference is not valid.
   */
  @withSpan()
  private listConfigRefs(config: components['schemas']['config']['config']): ConfigReference[] {
    this.logger.debug('Listing all the config references in the config object');
    const refs: ConfigReference[] = [];

    pointer.walk(config, (val, key) => {
      if (key.endsWith('$ref/configName')) {
        const refPointer = key.slice(0, key.lastIndexOf('/'));

        const val = pointer.get(config, refPointer) as unknown;
        if (!this.configValidator.validateRef(val)) {
          throw new ConfigValidationError(`The reference is not valid: ${JSON.stringify(val)}`);
        }
        refs.push(val);
      }
    });

    return refs;
  }

  /**
   * Recursively replaces the references in the given object with the corresponding configuration values.
   * @param obj - The object containing references to be replaced.
   * @param refs - The list of configuration references.
   * @throws {ConfigValidationError} If the configuration is not valid.
   */
  @withSpan()
  private replaceRefs(obj: JsonObject, refs: Awaited<ReturnType<typeof this.configRepository.getAllConfigRefs>>): void {
    this.logger.debug('Replacing all the references in the object with the corresponding values');

    // the input is not an object or an array so we don't need to do anything
    if (!Array.isArray(obj) && typeof obj !== 'object') {
      this.logger.debug('The object is not an object or an array, skipping');
      return;
    }

    const paths = new Map<string, ConfigReference>();

    this.logger.debug('Finding all the references in the object');
    // find all the references in the object
    pointer.walk(obj, (val, key) => {
      if (key.endsWith('$ref/configName')) {
        const refPath = key.slice(0, key.lastIndexOf('/'));
        const ref = pointer.get(obj, refPath) as unknown;
        if (!this.configValidator.validateRef(ref)) {
          this.logger.debug({ refPath, msg: 'The reference in the following path is not valid' });
          throw new ConfigValidationError(`The reference in the following path ${refPath} is not valid`);
        }

        paths.set(key.slice(0, key.lastIndexOf('/$ref/configName')), ref);
      }
    });

    for (const [path, ref] of paths) {
      this.logger.debug({ refPath: path, referenceObject: ref, msg: 'Replacing the reference in the object' });
      const config = refs.find(
        (r) => r.configName === ref.configName && (ref.version === 'latest' || r.version === ref.version) && r.schemaId === ref.schemaId
      );
      if (!config) {
        throw new Error(`could not find ref in db: ${JSON.stringify(ref)}`);
      }

      // replace the reference in the child object
      this.replaceRefs(config.config, refs);

      const prevValue = pointer.get(obj, path) as Record<string, unknown>;
      let replacementValue = config.config;

      // if the config is an object we can merge it with the previous value
      if (!Array.isArray(config.config) && typeof config.config === 'object') {
        delete prevValue.$ref;
        replacementValue = { ...prevValue, ...config.config };
      }

      if (path === '') {
        this.logger.debug('The reference is in the root of the object, replacing the object with the reference');
        Object.assign(obj, replacementValue);
        continue;
      }

      pointer.set(obj, path, replacementValue);
    }
  }

  /**
   * Calculates a Merkle-tree hash for a config based on its body and dependency hashes.
   * Hash = SHA256(StableJSON(Body) + SortedListOf(DependencyHashes))
   * @param configBody - The configuration body to hash
   * @param refs - The list of config references
   * @param resolvedRefs - The resolved config references with their hashes
   * @returns The calculated hash as a hex string
   */
  @withSpan()
  /**
   * Propagates hash changes to all parent configurations that depend on the updated config.
   * Updates parent hashes in-place without creating new versions.
   * Uses a recursive CTE to fetch entire parent tree, then processes level-by-level.
   * @param childConfigName - The name of the config that was updated
   * @param childSchemaId - The schema ID of the config that was updated
   * @param childVersion - The version of the config that was updated
   */
  @withSpan()
  private async propagateHashToParents(childConfigName: string, childSchemaId: string, childVersion: number): Promise<void> {
    this.logger.debug({ childConfigName, childSchemaId, childVersion, msg: 'Propagating hash changes to parent configs' });

    // Use recursive CTE to fetch ALL parents in the entire tree with depth levels
    const allParents = await this.configRepository.getAllParentConfigsRecursive(childConfigName, childSchemaId, childVersion);

    if (allParents.length === 0) {
      this.logger.debug('No parent configs found, skipping propagation');
      return;
    }

    const maxDepth = allParents.reduce((max, p) => Math.max(max, p.depth), 0);
    this.logger.info({
      totalParents: allParents.length,
      maxDepth,
      msg: 'Found all parent configs in dependency tree',
    });
    setSpanAttributes({ totalParentCount: allParents.length, maxDepth });

    // Build cache that will be updated as we process each level
    const resolvedRefsCache = new Map<string, ConfigRefResponse>();

    // Process parents level by level (depth 1, then depth 2, etc.)
    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
      const parentsAtLevel = allParents.filter((p) => p.depth === currentDepth);

      this.logger.debug({
        depth: currentDepth,
        parentCount: parentsAtLevel.length,
        msg: 'Processing parents at depth level',
      });

      await this.processParentsAtDepthLevel(currentDepth, parentsAtLevel, resolvedRefsCache);
    }

    this.logger.info({ maxDepth, msg: 'Hash propagation completed for all levels' });
  }

  public async insertDefaultConfigs(): Promise<void> {
    this.logger.info('Inserting default configs');

    const configsToInsert = new Map<string, DefaultConfigToInsert>();
    for await (const file of filesTreeGenerator(schemasBasePath, (path) => path.endsWith('.configs.json'))) {
      const configs = JSON.parse(fs.readFileSync(path.join(file.parentPath, file.name), 'utf-8')) as { name: string; value: unknown }[];
      const schemaId = 'https://mapcolonies.com' + file.parentPath.split('schemas/build/schemas')[1] + '/' + file.name.replace('.configs.json', '');
      for (const config of configs) {
        configsToInsert.set(config.name, {
          configName: config.name,
          schemaId,
          version: 1,
          config: config.value as Config['config'],
          refs: this.listConfigRefs(config.value as Config['config']),
          visited: false,
        });
      }
    }

    for (const [name] of configsToInsert) {
      await this.insertDefaultConfig(name, configsToInsert);
    }
  }

  public async updateOldConfigs(): Promise<void> {
    this.logger.info('Updating old configs to the new schema version');

    const BATCH_SIZE = 100;
    const NO_CONFIGS_TO_UPDATE = 0;
    let totalProcessed = 0;
    const failedConfigKeys = new Set<string>();

    // Process configs in batches until no more exist
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (true) {
      const configsToUpdate = await this.configRepository.getConfigs({ configSchemaVersion: 'v1' }, { offset: 0, limit: BATCH_SIZE });

      // Exit if no configs to update
      if (configsToUpdate.totalCount - failedConfigKeys.size === NO_CONFIGS_TO_UPDATE) {
        if (totalProcessed === NO_CONFIGS_TO_UPDATE) {
          this.logger.info('No old configs found, nothing to update');
        }
        break;
      }

      this.logger.info(`Found ${configsToUpdate.totalCount} old configs remaining to update`);

      // Process each config in the current batch
      for (const config of configsToUpdate.configs) {
        if (failedConfigKeys.has(getConfigCacheKey(config))) {
          this.logger.info(`Skipping previously failed config: ${config.configName} (${config.schemaId}) version ${config.version}`);
          continue;
        }

        try {
          this.logger.debug(`Updating config: ${config.configName} (${config.schemaId}) version ${config.version}`);

          const updatedConfig = await this.updateRefsToV2Schema(config.config);
          await this.configRepository.updateConfigToNewSchemaVersion({
            configName: config.configName,
            schemaId: config.schemaId,
            version: config.version,
            newSchemaVersion: 'v2',
            config: updatedConfig,
          });

          totalProcessed++;
          this.logger.info(`Updated config ${config.configName} to the new schema version (${totalProcessed} processed)`);
        } catch (error) {
          this.logger.error({ msg: `Failed to update config ${config.configName}:`, err: error });
          failedConfigKeys.add(getConfigCacheKey(config));
          // Continue processing other configs even if one fails
        }
      }
    }

    this.logger.info(`Config update completed. Total processed: ${totalProcessed}`);
  }

  /**
   * Processes all parent configs at a specific depth level during hash propagation.
   * Fetches missing refs, calculates new hashes, updates cache, and persists to DB.
   */
  private async processParentsAtDepthLevel(
    currentDepth: number,
    parentsAtLevel: Config[],
    resolvedRefsCache: Map<string, ConfigRefResponse>
  ): Promise<void> {
    // Step 1: Collect all refs needed for this level and fetch missing ones
    const parentRefMap = await this.hashPropagationHelper.fetchAndCacheRefsForParents(currentDepth, parentsAtLevel, resolvedRefsCache, (config) =>
      this.listConfigRefs(config)
    );

    // Step 2: Calculate new hashes for all parents at this level
    const hashUpdates = this.hashPropagationHelper.calculateHashUpdatesForParents(
      currentDepth,
      parentsAtLevel,
      parentRefMap,
      resolvedRefsCache,
      (config, refs, resolvedRefs) => this.hashPropagationHelper.calculateConfigHash(config, refs, resolvedRefs)
    );

    // Step 3: Batch update all changed hashes to database
    if (hashUpdates.length > 0) {
      this.logger.info({
        depth: currentDepth,
        updateCount: hashUpdates.length,
        msg: 'Updating parent config hashes in batch',
      });
      await this.configRepository.updateConfigHashes(hashUpdates);
    }
  }

  /**
   * Updates config references from v1 schema format to v2 schema format.
   * In v1, refs only contained configName and version.
   * In v2, refs also need to contain schemaId.
   * @param config - The config object to update
   * @returns The updated config object with v2 schema refs
   */
  private async updateRefsToV2Schema(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const updatedConfig = Clone(config);

    // Collect all refs that need to be updated
    const refsToUpdate: { refPath: string; oldRef: { configName: string; version: number | 'latest' } }[] = [];

    // Find all $ref objects in the config
    pointer.walk(updatedConfig, (val, key) => {
      if (key.endsWith('$ref/configName')) {
        const refPath = key.slice(0, key.lastIndexOf('/'));
        const refObject = pointer.get(updatedConfig, refPath) as unknown;

        // Check if this is an old format ref (has configName and version but no schemaId)
        if (
          refObject !== null &&
          typeof refObject === 'object' &&
          'configName' in refObject &&
          'version' in refObject &&
          !('schemaId' in refObject)
        ) {
          const oldRef = refObject as { configName: string; version: number | 'latest' };
          refsToUpdate.push({ refPath, oldRef });
        }
      }
    });

    // Update each ref by fetching the schemaId from the database
    for (const { refPath, oldRef } of refsToUpdate) {
      try {
        // Fetch the referenced config from database to get its schemaId
        const configsWithSameName = await this.configRepository.getConfigs({
          configName: oldRef.configName,
          version: oldRef.version === 'latest' ? undefined : oldRef.version,
        });

        // Get the first matching config to extract schemaId
        const referencedConfig = configsWithSameName.configs[0];

        if (!referencedConfig) {
          this.logger.warn(`No config found for ref update: ${oldRef.configName} version ${oldRef.version}`);
          continue;
        }

        // Update the ref object to include schemaId
        const updatedRef = {
          configName: oldRef.configName,
          version: oldRef.version,
          schemaId: referencedConfig.schemaId,
        };

        pointer.set(updatedConfig, refPath, updatedRef);

        this.logger.debug(`Updated ref ${oldRef.configName} to include schemaId: ${referencedConfig.schemaId}`);
      } catch (error) {
        this.logger.error({ msg: `Failed to update ref ${oldRef.configName}`, err: error });
      }
    }

    return updatedConfig;
  }

  private async insertDefaultConfig(name: string, configs: Map<string, DefaultConfigToInsert>): Promise<void> {
    const config = configs.get(name);

    if (!config) {
      throw new Error(`could not find config ${name}`);
    }

    if (config.visited) {
      return;
    }

    config.visited = true;

    const existingConfig = await this.configRepository.getConfig(config.configName, config.schemaId);
    if (existingConfig) {
      return;
    }

    if (config.refs.length > 0) {
      for (const ref of config.refs) {
        await this.insertDefaultConfig(ref.configName, configs);
      }
    }

    await this.createConfig(config);
    this.logger.info(`Inserted default config ${name}`);
  }

  /**
   * Calculates statistics about a config
   */
  @withSpan()
  private calculateConfigStats(config: object, refs: ConfigReference[]): ConfigStats {
    const jsonString = JSON.stringify(config);

    return {
      configSize: Buffer.byteLength(jsonString, 'utf8'),
      keyCount: this.countKeys(config),
      refCount: refs.length,
      depth: this.calculateDepth(config),
    };
  }

  /**
   * Recursively counts all keys in an object
   */
  private countKeys(obj: unknown): number {
    if (typeof obj !== 'object' || obj === null) {
      return 0;
    }

    let count = 0;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        count += this.countKeys(item);
      }
    } else {
      for (const key in obj) {
        count++; // Count this key
        count += this.countKeys((obj as Record<string, unknown>)[key]);
      }
    }

    return count;
  }

  /**
   * Calculates maximum nesting depth of an object
   */
  private calculateDepth(obj: unknown, currentDepth: number = 0): number {
    if (typeof obj !== 'object' || obj === null) {
      return currentDepth;
    }

    let maxDepth = currentDepth;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        maxDepth = Math.max(maxDepth, this.calculateDepth(item, currentDepth + 1));
      }
    } else {
      for (const key in obj) {
        maxDepth = Math.max(maxDepth, this.calculateDepth((obj as Record<string, unknown>)[key], currentDepth + 1));
      }
    }

    return maxDepth;
  }

  /**
   * Applies schema defaults to a config object
   * Uses AJV's useDefaults feature (already configured in Validator)
   */
  @withSpan()
  private async applySchemaDefaults(config: object, schemaId: string): Promise<object> {
    const configCopy = Clone(config);

    // Validate with AJV - this mutates configCopy to fill in defaults
    // due to useDefaults: true in Validator constructor
    await this.configValidator.isValid(schemaId, configCopy);

    // configCopy now has defaults applied
    return configCopy;
  }

  /**
   * Enriches env var data with current actual values from the config
   */
  private enrichEnvVarsWithCurrentValues(envVars: EnvVar[], configWithDefaults: object): EnvVarWithValue[] {
    return envVars.map((envVar) => {
      const actualValue = this.getValueAtPath(configWithDefaults, envVar.configPath);

      // Determine if using default or config-provided value
      const isUsingDefault = JSON.stringify(actualValue) === JSON.stringify(envVar.default);

      return {
        ...envVar,
        currentValue: actualValue,
        valueSource: isUsingDefault ? 'default' : 'config',
      };
    });
  }

  /**
   * Retrieves value at a JSON path like "database.host"
   */
  private getValueAtPath(obj: unknown, path: string): unknown {
    if (!path) {
      return obj;
    }

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (typeof current === 'object' && current !== null && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Extracts human-readable name from schema ID
   * Example: "https://mapcolonies.com/common/db/v1" → "common.db"
   */
  private extractNameFromSchemaId(schemaId: string): string {
    const parts = schemaId.replace('https://mapcolonies.com/', '').split('/');
    const EXCLUDE_LAST_ELEMENT = -1;
    return parts.slice(0, EXCLUDE_LAST_ELEMENT).join('.');
  }

  /**
   * Extracts version from schema ID
   * Example: "https://mapcolonies.com/common/db/v1" → "v1"
   */
  private extractVersionFromSchemaId(schemaId: string): string {
    const parts = schemaId.split('/');
    const lastIndex = parts.length + NOT_FOUND_INDEX;
    return parts[lastIndex] ?? 'v1';
  }

  /**
   * Extracts category from schema ID
   * Example: "https://mapcolonies.com/common/db/v1" → "common"
   */
  private extractCategoryFromSchemaId(schemaId: string): string {
    const parts = schemaId.replace('https://mapcolonies.com/', '').split('/');
    return parts[0] ?? 'unknown';
  }

  /**
   * Builds a ConfigReference node from one or more config versions
   * Merges multiple versions into a single node with version array
   */
  private buildConfigReferenceNode(
    configs: { configName: string; version: number; schemaId: string; isLatest: boolean; createdAt?: Date; createdBy?: string; hash?: string }[]
  ): ConfigReferenceType {
    if (configs.length === 1) {
      // Single version - simple node
      return {
        configName: configs[0]!.configName,
        version: configs[0]!.version,
        schemaId: configs[0]!.schemaId,
        isLatest: configs[0]!.isLatest,
      };
    }

    // Multiple versions - merge them
    const firstConfig = configs[0]!;
    return {
      configName: firstConfig.configName,
      version: configs.map((c) => c.version), // Array of versions
      schemaId: firstConfig.schemaId,
      isLatest: configs.some((c) => c.isLatest),
      versions: configs
        .filter((c) => c.createdAt !== undefined && c.createdBy !== undefined && c.hash !== undefined)
        .map((c) => ({
          version: c.version,
          createdAt: formatISO(c.createdAt!),
          createdBy: c.createdBy!,
          isLatest: c.isLatest,
          hash: c.hash!,
        })),
    } as ConfigReferenceType;
  }

  /**
   * Recursively gets child configs (configs that this config references)
   * Returns a nested tree structure with depth limit
   * Pattern: Based on schemaManager.getChildSchemas()
   */
  @withSpan()
  private async getChildConfigs(
    configName: string,
    schemaId: string,
    version: number,
    visited: Set<string> = new Set(),
    currentDepth: number = 0,
    maxDepth: number = MAX_RECURSION_DEPTH
  ): Promise<ConfigReferenceType[]> {
    // Stop at max depth
    if (currentDepth >= maxDepth) {
      return [];
    }

    // Prevent circular dependencies
    const cacheKey = `${configName}:${schemaId}:${version}`;
    if (visited.has(cacheKey)) {
      return [];
    }
    visited.add(cacheKey);

    const children: ConfigReferenceType[] = [];

    try {
      // Get the config
      const config = await this.configRepository.getConfig(configName, schemaId, version);
      if (!config) {
        return [];
      }

      // Extract refs from this config
      const refs = this.listConfigRefs(config.config);
      if (refs.length === 0) {
        return [];
      }

      // Get the actual referenced configs (non-recursive)
      const resolvedRefs = await this.configRepository.getConfigRefs(refs);

      // Group by configName + schemaId to merge versions
      const groupedRefs = new Map<string, typeof resolvedRefs>();
      for (const ref of resolvedRefs) {
        const key = `${ref.configName}:${ref.schemaId}`;
        const existing = groupedRefs.get(key) ?? [];
        existing.push(ref);
        groupedRefs.set(key, existing);
      }

      // Build tree nodes with version merging
      for (const [, refGroup] of groupedRefs) {
        const firstRef = refGroup[0]!;
        const childNode = this.buildConfigReferenceNode(refGroup);

        // Recursively get this child's children (using first ref's version)
        const descendantChildren = await this.getChildConfigs(
          firstRef.configName,
          firstRef.schemaId,
          firstRef.version,
          visited,
          currentDepth + 1,
          maxDepth
        );

        if (descendantChildren.length > 0) {
          childNode.children = descendantChildren;
        }

        children.push(childNode);
      }
    } catch (err) {
      this.logger.warn({
        msg: 'Failed to extract child configs',
        configName,
        schemaId,
        version,
        err,
      });
    }

    return children;
  }

  /**
   * Recursively gets parent configs (configs that reference this config)
   * Returns a nested tree structure with depth limit
   * Pattern: Based on schemaManager.getParentSchemas()
   */
  @withSpan()
  private async getParentConfigs(
    configName: string,
    schemaId: string,
    version: number,
    visited: Set<string> = new Set(),
    currentDepth: number = 0,
    maxDepth: number = MAX_RECURSION_DEPTH
  ): Promise<ConfigReferenceType[]> {
    // Stop at max depth
    if (currentDepth >= maxDepth) {
      return [];
    }

    // Prevent circular dependencies
    const cacheKey = `${configName}:${schemaId}:${version}`;
    if (visited.has(cacheKey)) {
      return [];
    }
    visited.add(cacheKey);

    const parents: ConfigReferenceType[] = [];

    try {
      // Use existing repository method to get direct parents
      const directParents = await this.configRepository.getParentConfigs(configName, schemaId, version);

      if (directParents.length === 0) {
        return [];
      }

      // Group by configName + schemaId to merge versions
      const groupedParents = new Map<string, typeof directParents>();
      for (const parent of directParents) {
        const key = `${parent.configName}:${parent.schemaId}`;
        const existing = groupedParents.get(key) ?? [];
        existing.push(parent);
        groupedParents.set(key, existing);
      }

      // Build tree nodes with version merging
      for (const [, parentGroup] of groupedParents) {
        const firstParent = parentGroup[0]!;
        const parentNode = this.buildConfigReferenceNode(parentGroup);

        // Recursively get this parent's parents (ancestors)
        const ancestorParents = await this.getParentConfigs(
          firstParent.configName,
          firstParent.schemaId,
          firstParent.version,
          visited,
          currentDepth + 1,
          maxDepth
        );

        if (ancestorParents.length > 0) {
          parentNode.parents = ancestorParents;
        }

        parents.push(parentNode);
      }
    } catch (err) {
      this.logger.warn({
        msg: 'Failed to find parent configs',
        configName,
        schemaId,
        version,
        err,
      });
    }

    return parents;
  }

  /**
   * Generate comprehensive config metadata (uncached)
   * Internal method used by cached getFullConfigMetadata
   */
  @withSpan()
  private async generateFullConfigMetadata(name: string, schemaId: string, version?: number): Promise<ConfigFullMetadata> {
    this.logger.info({ msg: 'Generating full config metadata', name, schemaId, version });

    // 1. Fetch raw and resolved config in parallel
    const [rawConfig, resolvedResult] = await Promise.all([
      this.getConfig(name, schemaId, version, false),
      this.configRepository.getConfigRecursive(name, schemaId, version),
    ]);

    if (!resolvedResult) {
      throw new ConfigNotFoundError('Config not found');
    }

    const [resolvedConfigData, refs] = resolvedResult;

    // Apply refs to get fully resolved config
    const resolvedConfig = Clone(resolvedConfigData.config);
    if (refs.length > 0) {
      this.replaceRefs(resolvedConfig, refs);
    }

    // 2. Apply schema defaults to resolved config
    const configWithDefaults = await this.applySchemaDefaults(resolvedConfig, schemaId);

    // 3. Fetch additional data in parallel
    const [allVersions, schema, childTree, parentTree] = await Promise.all([
      this.configRepository.getConfigs({ configName: name, schemaId }, { limit: 1000, offset: 0 }),
      this.schemaManager.getSchema(schemaId, false),
      this.getChildConfigs(name, schemaId, rawConfig.version, new Set(), 0, MAX_RECURSION_DEPTH),
      this.getParentConfigs(name, schemaId, rawConfig.version, new Set(), 0, MAX_RECURSION_DEPTH),
    ]);

    // 4. Extract and enrich env vars
    const baseEnvVars = this.schemaManager.extractEnvVars(schema);
    const envVars = this.enrichEnvVarsWithCurrentValues(baseEnvVars, configWithDefaults);

    // 5. Calculate statistics
    const configRefs = this.listConfigRefs(rawConfig.config);
    const stats = this.calculateConfigStats(rawConfig.config, configRefs);

    // 6. Build metadata object
    const metadata: ConfigFullMetadata = {
      configName: name,
      version: rawConfig.version,
      schemaId,
      isLatest: rawConfig.isLatest,
      createdAt: formatISO(rawConfig.createdAt),
      createdBy: rawConfig.createdBy,
      hash: rawConfig.hash,

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      rawConfig: rawConfig.config as Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      resolvedConfig: resolvedConfig as Record<string, unknown>,

      configWithDefaults: configWithDefaults as Record<string, unknown>,

      schema: {
        id: schemaId,
        name: this.extractNameFromSchemaId(schemaId),
        version: this.extractVersionFromSchemaId(schemaId),
        category: this.extractCategoryFromSchemaId(schemaId),
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        description: schema.description as string | undefined,
      },

      dependencies: {
        children: childTree,
        parents: parentTree,
      },

      versions: {
        total: allVersions.totalCount,
        all: allVersions.configs.map((c) => ({
          version: c.version,
          createdAt: formatISO(c.createdAt),
          createdBy: c.createdBy,
          isLatest: c.isLatest,
          hash: c.hash,
        })),
      },

      envVars,
      stats,
    };

    return metadata;
  }

  /**
   * Get comprehensive config metadata for inspector page (cached)
   * Pattern: Based on schemaManager.getFullSchemaMetadata()
   */
  @withSpan()
  public async getFullConfigMetadata(name: string, schemaId: string, version?: number): Promise<ConfigFullMetadata> {
    // Use cached function - the define() method adds getMetadata dynamically to the cache object
    // TypeScript doesn't track this dynamic addition, so we need to cast to access the method
    type CacheWithGetMetadata = ReturnType<typeof createCache> & {
      getMetadata: (params: { name: string; schemaId: string; version?: number }) => Promise<ConfigFullMetadata>;
    };
    return (this.fullConfigCache as CacheWithGetMetadata).getMetadata({ name, schemaId, version });
  }
}
