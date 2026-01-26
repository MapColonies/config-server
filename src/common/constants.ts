import { readPackageJsonSync } from '@map-colonies/read-pkg';

const schemasPackagePath = require.resolve('@map-colonies/schemas').substring(0, require.resolve('@map-colonies/schemas').indexOf('build'));
export const schemasPackageVersion = readPackageJsonSync(schemasPackagePath + 'package.json').version as string;

export const SERVICE_NAME = readPackageJsonSync().name ?? 'unknown_service';
export const DEFAULT_SERVER_PORT = 80;
export const DB_CONNECTION_TIMEOUT = 5000;

export const MILLISECONDS_IN_SECOND = 1000;

export const IGNORED_OUTGOING_TRACE_ROUTES = [/^.*\/v1\/metrics.*$/];
export const IGNORED_INCOMING_TRACE_ROUTES = [/^.*\/docs.*$/];

/* eslint-disable @typescript-eslint/naming-convention */
export const SERVICES = {
  LOGGER: Symbol('Logger'),
  CONFIG: Symbol('Config'),
  METER: Symbol('Meter'),
  PG_POOL: Symbol('PgPool'),
  DRIZZLE: Symbol('Drizzle'),
  HEALTHCHECK: Symbol('Healthcheck'),
} satisfies Record<string, symbol>;
/* eslint-enable @typescript-eslint/naming-convention */
