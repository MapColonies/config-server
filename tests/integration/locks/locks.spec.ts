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
});
