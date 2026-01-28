import { inject, injectable } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import { SERVICES } from '@common/constants';
import { withSpan } from '@common/tracing';
import { LockRepository } from '../repositories/lockRepository';

const RETRY_AFTER_JITTER = 3; // Jitter range in seconds
const RETRY_AFTER_MIN = 1; // Minimum retry-after value in seconds
const RETRY_AFTER_TTL_PERCENTAGE = 0.5; // Retry at 50% of remaining TTL (optimistic retries)
const MILLISECONDS_IN_SECOND = 1000;

@injectable()
export class LockManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(LockRepository) private readonly lockRepository: LockRepository
  ) {}

  @withSpan()
  public async acquireLock(key: string, callerId: string, ttl: number, limit: number): Promise<{ acquired: boolean; retryAfter?: number }> {
    this.logger.info({ key, callerId, ttl, limit, msg: 'Lock acquisition request' });

    const result = await this.lockRepository.acquireOrRenewLock(key, callerId, ttl, limit);

    if (!result.acquired) {
      // Calculate retry-after based on earliest lock expiration
      let retryAfter: number;

      if (result.earliestExpiresAt) {
        // Calculate time until earliest lock expires (in seconds)
        const now = Date.now();
        const expiresAtMs = result.earliestExpiresAt.getTime();
        const timeUntilExpiry = Math.max(0, Math.ceil((expiresAtMs - now) / MILLISECONDS_IN_SECOND));

        // Use a percentage of the TTL to be optimistic
        // This allows clients to retry before locks actually expire,
        // increasing chances of acquiring a lock if one is released early
        const optimisticRetry = Math.ceil(timeUntilExpiry * RETRY_AFTER_TTL_PERCENTAGE);

        // Ensure minimum retry time and add jitter to avoid thundering herd
        const baseRetry = Math.max(optimisticRetry, RETRY_AFTER_MIN);
        const jitter = Math.floor(Math.random() * RETRY_AFTER_JITTER);
        retryAfter = baseRetry + jitter;
      } else {
        // Fallback if earliestExpiresAt is not available
        retryAfter = RETRY_AFTER_MIN + Math.floor(Math.random() * RETRY_AFTER_JITTER);
      }

      this.logger.info({ key, callerId, retryAfter, earliestExpiresAt: result.earliestExpiresAt, msg: 'Lock acquisition denied' });
      return { acquired: false, retryAfter };
    }

    this.logger.info({ key, callerId, msg: 'Lock acquisition successful' });
    return { acquired: true };
  }

  @withSpan()
  public async releaseLock(key: string, callerId: string): Promise<void> {
    this.logger.info({ key, callerId, msg: 'Lock release request' });
    await this.lockRepository.releaseLock(key, callerId);
    this.logger.info({ key, callerId, msg: 'Lock released successfully' });
  }
}
