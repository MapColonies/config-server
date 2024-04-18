import { Logger } from '@map-colonies/js-logger';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { ConfigManager } from '../models/configManager';
import { paths } from '../../schema';

type GetConfig = RequestHandler<undefined, paths['/capabilities']['get']['responses']['200']['content']['application/json']>;

@injectable()
export class ConfigController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(ConfigManager) private readonly manager: ConfigManager
  ) {}

  public getConfig: GetConfig = (req, res) => {
    const capabilities = this.manager.getConfig();
    return res.status(httpStatus.OK).json(capabilities);
  };
}
