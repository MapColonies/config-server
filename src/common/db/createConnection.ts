import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { Client, Pool, PoolConfig } from 'pg';

import { drizzle } from 'drizzle-orm/node-postgres';

type DbConfig = {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
} & PoolConfig;

function createConnectionOptions(dbConfig: DbConfig): PoolConfig {
  const { enableSslAuth, sslPaths, ...dataSourceOptions } = dbConfig;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  dataSourceOptions.application_name = `${hostname()}-${process.env.NODE_ENV ?? 'unknown_env'}`;
  if (enableSslAuth) {
    dataSourceOptions.password = undefined;
    dataSourceOptions.ssl = { key: readFileSync(sslPaths.key), cert: readFileSync(sslPaths.cert), ca: readFileSync(sslPaths.ca) };
  }
  return {
    ...dataSourceOptions,
  };
}

async function initConnection(dbConfig: PoolConfig): Promise<Pool> {
  const pool = new Pool(dbConfig);
  await pool.query('SELECT NOW()');
  return new Pool(dbConfig);
}

export function createDrizzle (pool: Pool): ReturnType<typeof drizzle> {
  return drizzle(pool, {schema: {
    
  }});
}
