import { Logger } from '@map-colonies/js-logger';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { ConfigManager } from '../models/configManager';
import { TypedRequestHandler } from '../../common/interfaces';

@injectable()
export class ConfigController {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(ConfigManager) private readonly manager: ConfigManager) {}

  public getConfig: TypedRequestHandler<'/config', 'get'> = async (req, res) => {
    await Promise.resolve();
    return res.status(httpStatus.NOT_IMPLEMENTED).send();
  };

  public getConfigByName: TypedRequestHandler<'/config/{name}', 'get'> = async (req, res) => {
    await Promise.resolve();
    return res.status(httpStatus.NOT_IMPLEMENTED).send();
  };

  public getConfigByVersion: TypedRequestHandler<'/config/{name}/{version}', 'get'> = async (req, res) => {
    await Promise.resolve();
    return res.status(httpStatus.NOT_IMPLEMENTED).send();
  };

  public postConfig: TypedRequestHandler<'/config', 'post'> = async (req, res) => {
    await Promise.resolve();
    return res.status(httpStatus.NOT_IMPLEMENTED).send();
  };
}
