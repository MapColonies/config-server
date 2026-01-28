import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { TypedRequestHandler } from '@common/interfaces';
import { LockManager } from '../models/lockManager';

@injectable()
export class LockController {
  public constructor(@inject(LockManager) private readonly manager: LockManager) {}

  public acquireLock: TypedRequestHandler<'/locks', 'post'> = async (req, res, next) => {
    try {
      const { key, callerId, ttl, limit } = req.body;

      const result = await this.manager.acquireLock(key, callerId, ttl, limit);

      if (!result.acquired) {
        // Set Retry-After header
        res.setHeader('Retry-After', result.retryAfter!.toString());
        return res.status(httpStatus.LOCKED).json({ message: 'Concurrency limit reached' });
      }

      return res.status(httpStatus.OK).json();
    } catch (error) {
      next(error);
    }
  };

  public releaseLock: TypedRequestHandler<'/locks/{key}/{callerId}', 'delete'> = async (req, res, next) => {
    try {
      const { key, callerId } = req.params;

      await this.manager.releaseLock(key, callerId);

      return res.status(httpStatus.NO_CONTENT).send();
    } catch (error) {
      next(error);
    }
  };
}
