import config from 'config';
import { getOtelMixin } from '@map-colonies/telemetry';
import { trace, metrics as OtelMetrics } from '@opentelemetry/api';
import { DependencyContainer } from 'tsyringe/dist/typings/types';
import jsLogger, { LoggerOptions } from '@map-colonies/js-logger';
import { instancePerContainerCachingFactory } from 'tsyringe';
import { Metrics } from '@map-colonies/telemetry';
import { SERVICES, SERVICE_NAME } from './common/constants';
import { tracing } from './common/tracing';
import { SCHEMA_ROUTER_SYMBOL, schemaRouterFactory } from './schemas/routes/schemaRouter';
import { InjectionObject, registerDependencies } from './common/dependencyRegistration';
import { CAPABILITIES_ROUTER_SYMBOL, capabilitiesRouterFactory } from './capabilities/routes/capabilitiesRouter';
import { CONFIG_ROUTER_SYMBOL, configRouterFactory } from './configs/routes/configRouter';
import { initConnection, createDrizzle, createConnectionOptions, DbConfig } from './db/createConnection';

export interface RegisterOptions {
  override?: InjectionObject<unknown>[];
  useChild?: boolean;
}

export async function registerExternalValues(options?: RegisterOptions): Promise<DependencyContainer> {
  const loggerConfig = config.get<LoggerOptions>('telemetry.logger');
  const logger = jsLogger({ ...loggerConfig, prettyPrint: loggerConfig.prettyPrint, mixin: getOtelMixin() });

  const metrics = new Metrics();
  metrics.start();

  tracing.start();
  const tracer = trace.getTracer(SERVICE_NAME);

  const pool = await initConnection(createConnectionOptions(config.get<DbConfig>('db')));

  const dependencies: InjectionObject<unknown>[] = [
    { token: SERVICES.CONFIG, provider: { useValue: config } },
    { token: SERVICES.LOGGER, provider: { useValue: logger } },
    { token: SERVICES.TRACER, provider: { useValue: tracer } },
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
