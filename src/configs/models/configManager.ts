import fs from 'node:fs';
import path from 'node:path';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { Clone } from '@sinclair/typebox/value';
import pointer, { type JsonObject } from 'json-pointer';
import { parseISO } from 'date-fns';
import { paths, components } from '@openapi';
import type { Prettify } from '@common/interfaces';
import { SERVICES } from '@common/constants';
import { enrichLogContext } from '@common/logger';
import { setSpanAttributes, withSpan } from '@common/tracing';
import { filesTreeGenerator, removeSchemaVersion } from '@common/utils';
import { ConfigRepository, ConfigSearchParams, SqlPaginationParams } from '../repositories/configRepository';
import { schemasBasePath } from '../../schemas/models/schemaManager';
import { Config, SortOption } from './config';
import { Validator } from './configValidator';
import { ConfigNotFoundError, ConfigSchemaMismatchError, ConfigValidationError, ConfigVersionMismatchError } from './errors';
import { ConfigReference } from './configReference';

type GetConfigOptions = Prettify<Omit<NonNullable<paths['/config']['get']['parameters']['query']>, 'sort'> & { sort?: SortOption[] }>;

type DefaultConfigToInsert = Parameters<ConfigManager['createConfig']>[0] & {
  refs: ConfigReference[];
  visited: boolean;
};

@injectable()
export class ConfigManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(ConfigRepository) private readonly configRepository: ConfigRepository,
    @inject(Validator) private readonly configValidator: Validator
  ) {}

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

    await this.configRepository.createConfig({ ...config, createdBy: 'TBD', refs });
    enrichLogContext({ createdVersion: config.version }, true);
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
        if (failedConfigKeys.has(`${config.configName}::${config.schemaId}::${config.version}`)) {
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
          failedConfigKeys.add(`${config.configName}::${config.schemaId}::${config.version}`);
          // Continue processing other configs even if one fails
        }
      }
    }

    this.logger.info(`Config update completed. Total processed: ${totalProcessed}`);
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
}
