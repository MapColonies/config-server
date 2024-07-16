import { Logger } from '@map-colonies/js-logger';
import { formatISO } from 'date-fns';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { HttpError } from '@map-colonies/error-express-handler';
import { SERVICES } from '../../common/constants';
import { ConfigManager } from '../models/configManager';
import { TypedRequestHandler } from '../../common/interfaces';
import type { components } from '../../openapiTypes';
import { Config } from '../models/config';
import { ConfigNotFoundError, ConfigSchemaMismatchError, ConfigValidationError, ConfigVersionMismatchError } from '../models/errors';

function configMapper(config: Config): components['schemas']['config'] {
  return {
    ...config,
    createdAt: formatISO(config.createdAt),
  };
}

@injectable()
export class ConfigController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(ConfigManager) private readonly manager: ConfigManager
  ) {}

  public getConfigs: TypedRequestHandler<'/config', 'get'> = async (req, res, next) => {
    try {
      const getConfigsResult = await this.manager.getConfigs(req.query);
      const formattedConfigs = getConfigsResult.configs.map(configMapper);
      return res.status(httpStatus.OK).json({ configs: formattedConfigs, total: getConfigsResult.totalCount });
    } catch (error) {
      next(error);
    }
  };

  public getConfigByName: TypedRequestHandler<'/config/{name}', 'get'> = async (req, res, next) => {
    try {
      const config = await this.manager.getConfig(req.params.name, undefined, req.query?.shouldDereference);
      return res.status(httpStatus.OK).json(configMapper(config));
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      }

      next(error);
    }
  };

  public getConfigByVersion: TypedRequestHandler<'/config/{name}/{version}', 'get'> = async (req, res, next) => {
    const version = req.params.version !== 'latest' ? req.params.version : undefined;

    try {
      const config = await this.manager.getConfig(req.params.name, version, req.query?.shouldDereference);
      return res.status(httpStatus.OK).json(configMapper(config));
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      }

      next(error);
    }
  };

  public postConfig: TypedRequestHandler<'/config', 'post'> = async (req, res, next) => {
    try {
      await this.manager.createConfig(req.body);
      return res.status(httpStatus.CREATED).json();
    } catch (error) {
      if (error instanceof ConfigValidationError || error instanceof ConfigNotFoundError) {
        (error as HttpError).status = httpStatus.BAD_REQUEST;
      } else if (error instanceof ConfigVersionMismatchError || error instanceof ConfigSchemaMismatchError) {
        (error as HttpError).status = httpStatus.CONFLICT;
      }
      next(error);
    }
  };
}
