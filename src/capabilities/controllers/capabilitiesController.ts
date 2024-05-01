import { Logger } from '@map-colonies/js-logger';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { CapabilitiesManager } from '../models/capabilitiesManager';
import { paths } from '../../openapiTypes';

type GetCapabilities = RequestHandler<undefined, paths['/capabilities']['get']['responses']['200']['content']['application/json']>;

@injectable()
export class CapabilitiesController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(CapabilitiesManager) private readonly manager: CapabilitiesManager
  ) {}

  public getCapabilities: GetCapabilities = (req, res) => {
    const capabilities = this.manager.getCapabilities();
    return res.status(httpStatus.OK).json(capabilities);
  };
}
