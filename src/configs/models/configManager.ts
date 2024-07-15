import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { Clone } from '@sinclair/typebox/value';
import pointer, { JsonObject } from 'json-pointer';
import { parseISO } from 'date-fns';
import { ConfigRepository, ConfigSearchParams, SqlPaginationParams } from '../repositories/configRepository';
import { SERVICES } from '../../common/constants';
import { paths, components } from '../../openapiTypes';
import { Config } from './config';
import { Validator } from './configValidator';
import { ConfigNotFoundError, ConfigSchemaMismatchError, ConfigValidationError, ConfigVersionMismatchError } from './errors';
import { ConfigReference } from './configReference';

@injectable()
export class ConfigManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    private readonly configRepository: ConfigRepository,
    private readonly configValidator: Validator
  ) {}

  public async getConfig(name: string, version?: number, shouldDereferenceConfig?: boolean): Promise<Config> {
    if (shouldDereferenceConfig !== true) {
      const config = await this.configRepository.getConfig(name, version);

      if (!config) {
        throw new ConfigNotFoundError('Config not found');
      }
      return config;
    }

    const res = await this.configRepository.getConfigRecursive(name, version);
    if (!res) {
      throw new ConfigNotFoundError('Config not found');
    }

    const [config, refs] = res;

    if (refs.length > 0) {
      this.replaceRefs(config.config, refs);
    }

    return config;
  }

  public async getConfigs(options?: paths['/config']['get']['parameters']['query']): Promise<{ configs: Config[]; totalCount: number }> {
    const searchParams: ConfigSearchParams = {};
    let paginationParams: SqlPaginationParams = {};
    if (options) {
      const { offset, limit, ...querySearchParams } = options;
      paginationParams = { offset, limit };

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

    return this.configRepository.getConfigs(searchParams, paginationParams);
  }

  public async createConfig(config: Omit<components['schemas']['config'], 'createdAt' | 'createdBy'>): Promise<void> {
    const latestConfig = await this.configRepository.getConfig(config.configName);
    // const maxVersion = await this.configRepository.getConfigMaxVersion(config.configName);

    if (!latestConfig && config.version !== 1) {
      throw new ConfigVersionMismatchError('A new version of a config was submitted, when the config does not exists');
    }

    if (latestConfig) {
      if (config.version !== latestConfig.version) {
        throw new ConfigVersionMismatchError('The version of the config is not the next one in line');
      }

      if (config.schemaId !== latestConfig.schemaId) {
        throw new ConfigSchemaMismatchError('The schema id of the config is not the same as the rest of the configs with the same name');
      }
    }

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
      config.version++;
    }

    await this.configRepository.createConfig({ ...config, createdBy: 'TBD', refs });
  }

  /**
   * Retrieves all the config references from the given config object.
   * @param config - The config object to retrieve the references from.
   * @returns An array of config references.
   * @throws {ConfigValidationError} If the config reference is not valid.
   */
  private listConfigRefs(config: components['schemas']['config']['config']): ConfigReference[] {
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
  private replaceRefs(obj: JsonObject, refs: Awaited<ReturnType<typeof this.configRepository.getAllConfigRefs>>): void {
    // the input is not an object or an array so we don't need to do anything
    if (!Array.isArray(obj) && typeof obj !== 'object') {
      return;
    }

    const paths = new Map<string, ConfigReference>();

    // find all the references in the object
    pointer.walk(obj, (val, key) => {
      if (key.endsWith('$ref/configName')) {
        const refPath = key.slice(0, key.lastIndexOf('/'));
        const ref = pointer.get(obj, refPath) as unknown;
        if (!this.configValidator.validateRef(ref)) {
          throw new ConfigValidationError(`The reference in the following path ${refPath} is not valid`);
        }

        paths.set(key.slice(0, key.lastIndexOf('/$ref/configName')), ref);
      }
    });

    for (const [path, ref] of paths) {
      const config = refs.find((r) => r.configName === ref.configName && (ref.version === 'latest' || r.version === ref.version));
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

      pointer.set(obj, path, replacementValue);
    }
  }
}
