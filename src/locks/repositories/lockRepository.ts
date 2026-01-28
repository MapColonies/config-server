import { and, eq, lt, min, count, gt, sql } from 'drizzle-orm';
import { inject, scoped, Lifecycle } from 'tsyringe';
import type { Logger } from '@map-colonies/js-logger';
import type { Drizzle } from '@db';
import { SERVICES } from '@common/constants';
import { withSpan } from '@common/tracing';
import { locks, type Lock } from '../models/lock';

const MILLISECONDS_IN_SECOND = 1000;

/**
 * Hash a string key to a 32-bit integer for PostgreSQL advisory locks.
 * Uses a simple hash function to convert the key string to a number.
 */
function hashKeyToInt(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

@scoped(Lifecycle.ContainerScoped)
export class LockRepository {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.DRIZZLE) private readonly drizzle: Drizzle
  ) {}

  @withSpan()
  public async acquireOrRenewLock(
    key: string,
    callerId: string,
    ttl: number,
    limit: number
  ): Promise<{ acquired: boolean; activeCount?: number; earliestExpiresAt?: Date }> {
    this.logger.debug({ key, callerId, ttl, limit, msg: 'Attempting to acquire or renew lock' });

    return this.drizzle.transaction(
      async (tx) => {
        // Step 1: Cleanup expired locks for this key
        // This can run without the advisory lock since DELETE of expired rows is safe to race
        const now = new Date();
        await tx.delete(locks).where(and(eq(locks.key, key), lt(locks.expiresAt, now)));

        // Step 2: Check if this caller already has the lock (heartbeat case)
        // This can run without the advisory lock since the same callerId won't make concurrent requests
        const existingLock = await tx
          .select()
          .from(locks)
          .where(and(eq(locks.key, key), eq(locks.callerId, callerId)))
          .limit(1);

        if (existingLock.length > 0) {
          // Renew the lock by updating expires_at
          const expiresAt = new Date(Date.now() + ttl * MILLISECONDS_IN_SECOND);
          await tx
            .update(locks)
            .set({ expiresAt })
            .where(and(eq(locks.key, key), eq(locks.callerId, callerId)));

          this.logger.debug({ key, callerId, msg: 'Lock renewed (heartbeat)' });
          return { acquired: true };
        }

        // Acquire an advisory lock for this key to serialize COUNT + INSERT operations
        // This prevents race conditions where multiple NEW callers could both count < limit and insert
        const keyHash = hashKeyToInt(key);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${keyHash})`);

        // Step 3: Validate limit consistency - check if any existing locks have a different limit
        const existingLockWithLimit = await tx.select({ limit: locks.limit }).from(locks).where(eq(locks.key, key)).limit(1);

        if (existingLockWithLimit.length > 0) {
          const existingLimit = existingLockWithLimit[0]?.limit;
          if (existingLimit !== undefined && existingLimit !== limit) {
            this.logger.warn({
              key,
              callerId,
              requestedLimit: limit,
              existingLimit,
              msg: 'Limit mismatch - rejecting request',
            });
            throw new Error(`Limit mismatch for key "${key}": requested ${limit}, but existing locks use ${existingLimit}`);
          }
        }

        // Step 4: Count active locks for this key
        const countResult = await tx.select({ count: count() }).from(locks).where(eq(locks.key, key));

        const activeCount = Number(countResult[0]?.count ?? 0);

        // Step 5: Check if we can acquire a new lock
        if (activeCount < limit) {
          // Insert new lock
          const expiresAt = new Date(Date.now() + ttl * MILLISECONDS_IN_SECOND);
          await tx.insert(locks).values({
            key,
            callerId,
            expiresAt,
            limit,
          });

          this.logger.debug({ key, callerId, activeCount, limit, msg: 'Lock acquired' });
          return { acquired: true };
        }

        // Concurrency limit reached - get earliest expiration time
        const earliestExpiryResult = await tx
          .select({ earliestExpiresAt: min(locks.expiresAt) })
          .from(locks)
          .where(eq(locks.key, key));

        const earliestExpiresAt = earliestExpiryResult[0]?.earliestExpiresAt ?? undefined;

        this.logger.debug({ key, callerId, activeCount, limit, earliestExpiresAt, msg: 'Lock denied - limit reached' });
        return { acquired: false, activeCount, earliestExpiresAt };
      },
      {
        // Use READ COMMITTED isolation (default) since advisory lock handles serialization
        isolationLevel: 'read committed',
      }
    );
  }

  @withSpan()
  public async releaseLock(key: string, callerId: string): Promise<void> {
    this.logger.debug({ key, callerId, msg: 'Releasing lock' });
    await this.drizzle.delete(locks).where(and(eq(locks.key, key), eq(locks.callerId, callerId)));
  }

  @withSpan()
  public async getLock(key: string, callerId: string): Promise<Lock | undefined> {
    const result = await this.drizzle
      .select()
      .from(locks)
      .where(and(eq(locks.key, key), eq(locks.callerId, callerId)))
      .limit(1);

    return result[0];
  }

  @withSpan()
  public async getActiveLocks(key: string): Promise<Lock[]> {
    const now = new Date();
    return this.drizzle
      .select()
      .from(locks)
      .where(and(eq(locks.key, key), gt(locks.expiresAt, now)));
  }
}
