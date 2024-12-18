import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { TypedRequestHandler } from '@common/interfaces';
import { CapabilitiesManager } from '../models/capabilitiesManager';

@injectable()
export class CapabilitiesController {
  public constructor(@inject(CapabilitiesManager) private readonly manager: CapabilitiesManager) {}

  public getCapabilities: TypedRequestHandler<'/capabilities', 'get'> = (req, res) => {
    const capabilities = this.manager.getCapabilities();
    return res.status(httpStatus.OK).json(capabilities);
  };
}
