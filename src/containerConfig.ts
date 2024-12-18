import config from 'config';
import { metrics as OtelMetrics } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import { instancePerContainerCachingFactory } from 'tsyringe';
import type { Pool } from 'pg';
import { Metrics } from '@map-colonies/telemetry';
import { InjectionObject, registerDependencies } from '@common/dependencyRegistration';
import { SERVICES, SERVICE_NAME } from '@common/constants';
import { initConnection, createDrizzle, createConnectionOptions, DbConfig } from '@db';
import { tracing } from '@common/tracing';
import { SCHEMA_ROUTER_SYMBOL, schemaRouterFactory } from './schemas/routes/schemaRouter';
import { CAPABILITIES_ROUTER_SYMBOL, capabilitiesRouterFactory } from './capabilities/routes/capabilitiesRouter';
import { CONFIG_ROUTER_SYMBOL, configRouterFactory } from './configs/routes/configRouter';
import { loggerFactory } from './common/logger';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export async function registerExternalValues(options?: RegisterOptions): Promise<DependencyContainer> {
  const metrics = new Metrics();
  metrics.start();

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
      token: 'onSignal',
      provider: {
        useValue: async (): Promise<void> => {
          await Promise.all([tracing.stop(), metrics.stop(), pool.end()]);
        },
      },
    },
  ];

  return registerDependencies(dependencies, options?.override, options?.useChild);
}
