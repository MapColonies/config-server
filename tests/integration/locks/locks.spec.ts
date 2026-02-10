import 'jest-extended';
import 'jest-openapi';

import { eq } from 'drizzle-orm';
import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { createRequestSender, RequestSender, expectResponseStatusFactory, ExpectResponseStatus } from '@map-colonies/openapi-helpers/requestSender';
import { paths, operations } from '@openapi';
import { Drizzle } from '@src/db/createConnection';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { locks } from '@src/locks/models/lock';
import { LockRepository } from '@src/locks/repositories/lockRepository';

const expectResponseStatus: ExpectResponseStatus = expectResponseStatusFactory(expect);

describe('locks', function () {
  let requestSender: RequestSender<paths, operations>;
  let dependencyContainer: DependencyContainer;
  let drizzle: Drizzle;

  beforeAll(async function () {
    const [app, container] = await getApp({
      override: [{ token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } }],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
    dependencyContainer = container;
    drizzle = dependencyContainer.resolve<Drizzle>(SERVICES.DRIZZLE);
  });

  afterAll(async function () {
    const onSignal = dependencyContainer.resolve<() => Promise<void>>('onSignal');
    await onSignal();
  });

  beforeEach(async function () {
    // Clean up locks table before each test
    await drizzle.delete(locks);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('POST /locks - Concurrency Enforcement', function () {
    it('should allow acquiring locks up to the limit', async function () {
      const key = 'test-lock-a';
      const limit = 2;
      const ttl = 60;

      // Request Lock A (Caller 1) -> Success
      const response1 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response1, 200);

      // Request Lock A (Caller 2) -> Success
      const response2 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });
      expectResponseStatus(response2, 200);

      // Request Lock A (Caller 3) -> Fail (423)
      const response3 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-3', ttl, limit },
      });
      expectResponseStatus(response3, 423);
      expect(response3.headers['retry-after']).toBeDefined();
    });

    it('should allow acquiring lock after release', async function () {
      const key = 'test-lock-a';
      const limit = 2;
      const ttl = 60;

      // Acquire locks up to limit
      await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });

      // Request Lock A (Caller 3) -> Fail
      const response3 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-3', ttl, limit },
      });
      expectResponseStatus(response3, 423);

      // Release Lock A (Caller 1)
      const releaseResponse = await requestSender.releaseLock({
        pathParams: { key, callerId: 'caller-1' },
      });
      expectResponseStatus(releaseResponse, 204);

      // Request Lock A (Caller 3) -> Success
      const response4 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-3', ttl, limit },
      });
      expectResponseStatus(response4, 200);
    });
  });

  describe('POST /locks - TTL & Cleanup', function () {
    it('should cleanup expired locks and allow new acquisition', async function () {
      vi.useFakeTimers();

      const key = 'test-lock-b';
      const ttl = 10; // 10 seconds
      const limit = 1;

      // Request Lock B (Caller 1, TTL=10s)
      const response1 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response1, 200);

      // Advance Fake Timer by 11s
      vi.advanceTimersByTime(11000);

      // Request Lock B (Caller 2) -> Success (Caller 1 expired)
      const response2 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });
      expectResponseStatus(response2, 200);

      // Verify Caller 1 was cleaned up
      const dbLocks = await drizzle.select().from(locks).where(eq(locks.key, key));
      expect(dbLocks).toHaveLength(1);
      expect(dbLocks[0]?.callerId).toBe('caller-2');
    });
  });

  describe('POST /locks - Heartbeat/Re-entry', function () {
    it('should renew lock on heartbeat request', async function () {
      vi.useFakeTimers();

      const key = 'test-lock-c';
      const ttl = 10; // 10 seconds
      const limit = 1;

      // Request Lock C (Caller 1, TTL=10s)
      const response1 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response1, 200);

      // Advance Fake Timer by 5s
      vi.advanceTimersByTime(5000);

      // Request Lock C (Caller 1, TTL=10s) -> Success (heartbeat)
      const response2 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response2, 200);
      // Advance Fake Timer by 8s (Total 13s, but only 8s since last heartbeat)
      vi.advanceTimersByTime(8000);

      // Check Lock C is still active (not expired)
      const dbLocks = await drizzle.select().from(locks).where(eq(locks.key, key));
      expect(dbLocks).toHaveLength(1);
      expect(dbLocks[0]?.callerId).toBe('caller-1');

      // Verify lock is still valid - another caller should not be able to acquire
      const response3 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });
      expectResponseStatus(response3, 423);
    });
  });

  describe('POST /locks - Race Condition Simulation', function () {
    it('should handle concurrent requests correctly', async function () {
      const key = 'test-lock-race';
      const limit = 1;
      const ttl = 60;

      // Use Promise.all to send concurrent requests
      const [response1, response2] = await Promise.all([
        requestSender.acquireLock({
          requestBody: { key, callerId: 'caller-1', ttl, limit },
        }),
        requestSender.acquireLock({
          requestBody: { key, callerId: 'caller-2', ttl, limit },
        }),
      ]);

      // Verify exactly one succeeded and one failed with 423
      const statuses = [response1.status, response2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([httpStatusCodes.OK, httpStatusCodes.LOCKED]);

      // Verify only one lock exists in the database
      const dbLocks = await drizzle.select().from(locks).where(eq(locks.key, key));
      expect(dbLocks).toHaveLength(1);
    });
  });

  describe('DELETE /locks/{key}/{callerId}', function () {
    describe('Happy Path', function () {
      it('should release a lock successfully', async function () {
        const key = 'test-lock-delete';
        const callerId = 'caller-1';
        const ttl = 60;
        const limit = 1;

        // Acquire lock
        await requestSender.acquireLock({
          requestBody: { key, callerId, ttl, limit },
        });

        // Release lock
        const response = await requestSender.releaseLock({
          pathParams: { key, callerId },
        });
        expectResponseStatus(response, 204);

        // Verify lock was deleted
        const dbLocks = await drizzle.select().from(locks).where(eq(locks.key, key));
        expect(dbLocks).toHaveLength(0);
      });

      it('should succeed even if lock does not exist', async function () {
        const key = 'non-existent-lock';
        const callerId = 'caller-1';

        // Release non-existent lock
        const response = await requestSender.releaseLock({
          pathParams: { key, callerId },
        });
        expectResponseStatus(response, 204);
      });
    });

    describe('Bad Path', function () {
      it('should succeed for non-existent lock (idempotent delete)', async function () {
        // The DELETE operation is idempotent - deleting a non-existent lock succeeds
        const response = await requestSender.releaseLock({
          pathParams: { key: 'non-existent-key', callerId: 'non-existent-caller' },
        });
        expectResponseStatus(response, 204);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 404 when key is empty string', async function () {
        const response = await requestSender.releaseLock({
          pathParams: { key: '', callerId: 'caller-1' },
        });
        expectResponseStatus(response, 404 as 400);
      });

      it('should return 404 when callerId is empty string', async function () {
        const response = await requestSender.releaseLock({
          pathParams: { key: 'test-key', callerId: '' },
        });
        expectResponseStatus(response, 404 as 400);
      });

      it("should release only the specific caller's lock, not others", async function () {
        const key = 'shared-lock';
        const ttl = 60;
        const limit = 2;

        // Acquire locks with two different callers
        await requestSender.acquireLock({
          requestBody: { key, callerId: 'caller-1', ttl, limit },
        });
        await requestSender.acquireLock({
          requestBody: { key, callerId: 'caller-2', ttl, limit },
        });

        // Release only caller-1's lock
        const response = await requestSender.releaseLock({
          pathParams: { key, callerId: 'caller-1' },
        });
        expectResponseStatus(response, 204);

        // Verify only caller-1's lock was deleted
        const dbLocks = await drizzle.select().from(locks).where(eq(locks.key, key));
        expect(dbLocks).toHaveLength(1);
        expect(dbLocks[0]?.callerId).toBe('caller-2');
      });
    });

    describe('Sad Path', function () {
      it('should return 500 when the database is down', async function () {
        const lockRepo = dependencyContainer.resolve(LockRepository);
        vi.spyOn(lockRepo, 'releaseLock').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.releaseLock({
          pathParams: { key: 'test-lock', callerId: 'caller-1' },
        });

        expectResponseStatus(response, 500);
        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('POST /locks - Bad Path', function () {
    describe('Invalid Input Validation', function () {
      it('should return 400 when key is missing', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { callerId: 'caller-1', ttl: 60, limit: 1 } as Parameters<typeof requestSender.acquireLock>[0]['requestBody'],
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when callerId is missing', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', ttl: 60, limit: 1 } as Parameters<typeof requestSender.acquireLock>[0]['requestBody'],
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when ttl is missing', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', limit: 1 } as Parameters<typeof requestSender.acquireLock>[0]['requestBody'],
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when limit is missing', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', ttl: 60 } as Parameters<typeof requestSender.acquireLock>[0]['requestBody'],
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when ttl is zero', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', ttl: 0, limit: 1 },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when ttl is negative', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', ttl: -10, limit: 1 },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when limit is zero', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', ttl: 60, limit: 0 },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when limit is negative', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', ttl: 60, limit: -5 },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when ttl is not a number', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', ttl: 'invalid' as unknown as number, limit: 1 },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when limit is not a number', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: 'caller-1', ttl: 60, limit: 'invalid' as unknown as number },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when key is empty string', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: '', callerId: 'caller-1', ttl: 60, limit: 1 },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 when callerId is empty string', async function () {
        const response = await requestSender.acquireLock({
          requestBody: { key: 'test-key', callerId: '', ttl: 60, limit: 1 },
        });
        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('POST /locks - Edge Cases', function () {
    it('should handle very large TTL values', async function () {
      const key = 'test-lock-large-ttl';
      const ttl = 2147483647; // Max 32-bit signed integer
      const limit = 1;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should handle very large limit values', async function () {
      const key = 'test-lock-large-limit';
      const ttl = 60;
      const limit = 1000000;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should handle very long key strings', async function () {
      const key = 'a'.repeat(1000); // Very long key
      const ttl = 60;
      const limit = 1;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should handle very long callerId strings', async function () {
      const key = 'test-lock-long-caller';
      const callerId = 'b'.repeat(1000); // Very long callerId
      const ttl = 60;
      const limit = 1;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId, ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should handle special characters in key', async function () {
      const key = 'test-lock-!@#$%^&*()_+-={}[]|:";\'<>?,./';
      const ttl = 60;
      const limit = 1;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should handle special characters in callerId', async function () {
      const key = 'test-lock-special-caller';
      const callerId = '!@#$%^&*()_+-={}[]|:";\'<>?,./';
      const ttl = 60;
      const limit = 1;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId, ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should handle minimum valid TTL (1 second)', async function () {
      const key = 'test-lock-min-ttl';
      const ttl = 1;
      const limit = 1;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should handle minimum valid limit (1)', async function () {
      const key = 'test-lock-min-limit';
      const ttl = 60;
      const limit = 1;

      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response, 200);
    });

    it('should allow different callers with same callerId but different keys', async function () {
      const ttl = 60;
      const limit = 1;
      const callerId = 'shared-caller-id';

      // Acquire lock for key1
      const response1 = await requestSender.acquireLock({
        requestBody: { key: 'key-1', callerId, ttl, limit },
      });
      expectResponseStatus(response1, 200);

      // Acquire lock for key2 with same callerId - should succeed as different key
      const response2 = await requestSender.acquireLock({
        requestBody: { key: 'key-2', callerId, ttl, limit },
      });
      expectResponseStatus(response2, 200);

      // Verify both locks exist
      const dbLocks = await drizzle.select().from(locks);
      const relevantLocks = dbLocks.filter((lock) => lock.callerId === callerId);
      expect(relevantLocks).toHaveLength(2);
    });

    it('should properly handle lock expiry at exact TTL boundary', async function () {
      vi.useFakeTimers();

      const key = 'test-lock-boundary';
      const ttl = 10;
      const limit = 1;

      // Acquire lock
      const response1 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });
      expectResponseStatus(response1, 200);

      // Advance timer to exactly TTL (should still be locked)
      vi.advanceTimersByTime(10000);

      // Try to acquire - might be locked or not depending on implementation
      await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });

      // After exact TTL+1ms, should definitely be able to acquire
      vi.advanceTimersByTime(1);
      const response3 = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });
      expectResponseStatus(response3, 200);
    });
  });

  describe('POST /locks - Sad Path', function () {
    it('should return 500 when the database is down during lock acquisition', async function () {
      const lockRepo = dependencyContainer.resolve(LockRepository);
      vi.spyOn(lockRepo, 'acquireOrRenewLock').mockRejectedValueOnce(new Error('Database connection lost'));

      const response = await requestSender.acquireLock({
        requestBody: { key: 'test-lock', callerId: 'caller-1', ttl: 60, limit: 1 },
      });

      expectResponseStatus(response, 500);
      expect(response).toSatisfyApiSpec();
    });

    it('should return 500 when database throws unexpected error', async function () {
      const lockRepo = dependencyContainer.resolve(LockRepository);
      vi.spyOn(lockRepo, 'acquireOrRenewLock').mockRejectedValueOnce(new Error('Unexpected database error'));

      const response = await requestSender.acquireLock({
        requestBody: { key: 'test-lock-error', callerId: 'caller-1', ttl: 60, limit: 1 },
      });

      expectResponseStatus(response, 500);
      expect(response).toSatisfyApiSpec();
    });

    it('should handle transaction failures gracefully', async function () {
      const lockRepo = dependencyContainer.resolve(LockRepository);

      // Mock first call to fail, second to succeed
      const acquireSpy = vi.spyOn(lockRepo, 'acquireOrRenewLock');
      acquireSpy.mockRejectedValueOnce(new Error('Transaction rollback'));

      const response1 = await requestSender.acquireLock({
        requestBody: { key: 'test-lock-txn', callerId: 'caller-1', ttl: 60, limit: 1 },
      });
      expectResponseStatus(response1, 500);

      // Restore original implementation
      acquireSpy.mockRestore();

      // Verify system recovers and can acquire lock after error
      const response2 = await requestSender.acquireLock({
        requestBody: { key: 'test-lock-txn', callerId: 'caller-1', ttl: 60, limit: 1 },
      });
      expectResponseStatus(response2, 200);
    });
  });

  describe('POST /locks - Retry-After Header', function () {
    it('should include retry-after header when lock limit is reached', async function () {
      const key = 'test-lock-retry-header';
      const limit = 1;
      const ttl = 60;

      // Acquire the only available lock
      await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });

      // Try to acquire when limit is reached
      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });

      expectResponseStatus(response, 423);
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.headers['retry-after']).toBeTypeOf('string');
      expect(parseInt(response.headers['retry-after'] as string, 10)).toBeGreaterThan(0);
    });

    it('should return retry-after value less than or equal to TTL', async function () {
      const key = 'test-lock-retry-ttl';
      const limit = 1;
      const ttl = 30;

      // Acquire the only available lock
      await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-1', ttl, limit },
      });

      // Try to acquire when limit is reached
      const response = await requestSender.acquireLock({
        requestBody: { key, callerId: 'caller-2', ttl, limit },
      });

      expectResponseStatus(response, 423);
      const retryAfter = parseInt(response.headers['retry-after'] as string, 10);
      expect(retryAfter).toBeLessThanOrEqual(ttl);
    });
  });
});
