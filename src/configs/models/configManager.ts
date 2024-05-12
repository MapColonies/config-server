import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { parseISO } from 'date-fns';
import { ConfigRepository, ConfigSearchParams, SqlPaginationParams } from '../repositories/configRepository';
import { SERVICES } from '../../common/constants';
import { paths, components } from '../../openapiTypes';
import { Config } from './config';
import { Validator } from './configValidator';
import { ConfigNotFoundError, ConfigValidationError, ConfigVersionMismatchError } from './errors';

@injectable()
export class ConfigManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    private readonly configRepository: ConfigRepository,
    private readonly configValidator: Validator
  ) {}

  public async getConfig(name: string, version?: number): Promise<Config> {
    const config = await this.configRepository.getConfig(name, version);

    if (!config) {
      throw new ConfigNotFoundError('Config not found');
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
    const maxVersion = await this.configRepository.getConfigMaxVersion(config.configName);

    if (maxVersion === null && config.version !== 1) {
      throw new ConfigVersionMismatchError('A new version of a config was submitted, when the config does not exists');
    }

    if (maxVersion !== null && config.version !== maxVersion) {
      throw new ConfigVersionMismatchError('The version of the config is not the next one in line');
    }

    const [isValid, err] = await this.configValidator.isValid(config.schemaId, config.config);

    if (!isValid) {
      throw new ConfigValidationError(`The config is not valid: ${JSON.stringify(err)}`);
    }

    config.version++;

    await this.configRepository.createConfig({ ...config, createdBy: 'TBD' });
  }
}
