import 'jest-extended';
import 'jest-openapi';

import config from 'config';
import type { Pool } from 'pg';
import { describe, beforeAll, beforeEach, afterAll, it, expect, vi, type MockInstance } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import type { DependencyContainer } from 'tsyringe';
import { createRequestSender, type RequestSender } from '@map-colonies/openapi-helpers/requestSender';
import type { paths, operations } from '@openapi';
import { createConnectionOptions, initConnection, type DbConfig } from '@src/db/createConnection';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';

describe('database connection loss', function () {
  let requestSender: RequestSender<paths, operations>;
  let dependencyContainer: DependencyContainer;
  let appPool: Pool;
  let adminPool: Pool;
  let errorSpy: MockInstance;

  beforeAll(async function () {
    const logger = jsLogger({ enabled: false });
    errorSpy = vi.spyOn(logger, 'error');
    const [app, container] = await getApp({
      override: [{ token: SERVICES.LOGGER, provider: { useValue: logger } }],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
    dependencyContainer = container;
    appPool = dependencyContainer.resolve<Pool>(SERVICES.PG_POOL);
    adminPool = await initConnection(createConnectionOptions(config.get<DbConfig>('db')));
  });

  beforeEach(function () {
    errorSpy.mockClear();
  });

  afterAll(async function () {
    await adminPool.end();
    const onSignal = dependencyContainer.resolve<() => Promise<void>>('onSignal');
    await onSignal();
  });

  it('should keep serving requests after the database terminates an idle connection of the app', async function () {
    const client = await appPool.connect();
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    client.release();

    const countBefore = appPool.totalCount;
    await adminPool.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
    await vi.waitFor(() => expect(appPool.totalCount).toBe(countBefore - 1));

    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ msg: 'database connection error' }));

    const response = await requestSender.getConfigs({});

    expect(response.status).toBe(httpStatusCodes.OK);
  });

  it('should keep serving requests after the database terminates a connection the app has checked out', async function () {
    const client = await appPool.connect();
    const { rows } = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');

    const ended = new Promise((resolve) => client.once('end', resolve));
    await adminPool.query('SELECT pg_terminate_backend($1)', [rows[0]!.pid]);
    await ended;

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ msg: 'database connection error' })));

    await expect(client.query('SELECT 1')).rejects.toThrow();

    client.release(true);

    const response = await requestSender.getConfigs({});

    expect(response.status).toBe(httpStatusCodes.OK);
  });
});
