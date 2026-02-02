import config, { IConfig } from 'config';
import { metrics as OtelMetrics } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import { instancePerContainerCachingFactory } from 'tsyringe';
import type { Pool } from 'pg';
import { initConnection, createDrizzle, createConnectionOptions, DbConfig, Drizzle } from '@db';
import { InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { SERVICES, SERVICE_NAME } from '@common/constants';
import { tracing } from '@common/tracing';
import { SCHEMA_ROUTER_SYMBOL, schemaRouterFactory } from './schemas/routes/schemaRouter';
import { CAPABILITIES_ROUTER_SYMBOL, capabilitiesRouterFactory } from './capabilities/routes/capabilitiesRouter';
import { CONFIG_ROUTER_SYMBOL, configRouterFactory } from './configs/routes/configRouter';
import { LOCK_ROUTER_SYMBOL, lockRouterFactory } from './locks/routes/lockRouter';
import { loggerFactory } from './common/logger';
import { healthCheck } from './db/utils';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export async function registerExternalValues(options?: RegisterOptions): Promise<DependencyContainer> {
  let pool: Pool;
  try {
    pool = await initConnection(createConnectionOptions(config.get<DbConfig>('db')));
  } catch (error) {
    throw new Error(`Failed to connect to the database`, { cause: error });
  }

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: config } },
    { token: SERVICES.LOGGER, provider: { useFactory: instancePerContainerCachingFactory(loggerFactory) } },
    { token: SERVICES.METER, provider: { useValue: OtelMetrics.getMeterProvider().getMeter(SERVICE_NAME) } },
    { token: SCHEMA_ROUTER_SYMBOL, provider: { useFactory: schemaRouterFactory } },
    { token: CAPABILITIES_ROUTER_SYMBOL, provider: { useFactory: capabilitiesRouterFactory } },
    { token: CONFIG_ROUTER_SYMBOL, provider: { useFactory: configRouterFactory } },
    { token: LOCK_ROUTER_SYMBOL, provider: { useFactory: lockRouterFactory } },
    { token: SERVICES.PG_POOL, provider: { useValue: pool } },
    {
      token: SERVICES.DRIZZLE,
      provider: {
        useFactory: instancePerContainerCachingFactory((container) => {
          return createDrizzle(container.resolve(SERVICES.PG_POOL));
        }),
      },
    },
    {
      token: SERVICES.HEALTHCHECK,
      provider: {
        useFactory: instancePerContainerCachingFactory((container) => {
          const drizzle = container.resolve<Drizzle>(SERVICES.DRIZZLE);
          const config = container.resolve<IConfig>(SERVICES.CONFIG);

          const timeoutMs = config.get<number>('db.connectionTimeoutMs');
          return healthCheck(drizzle, timeoutMs);
        }),
      },
    },
    {
      token: 'onSignal',
      provider: {
        useValue: async (): Promise<void> => {
          await Promise.all([tracing.stop(), pool.end()]);
        },
      },
    },
  ];

  return registerDependencies(dependencies, options?.override, options?.useChild);
}
