import { hostname } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolConfig } from 'pg';
import { configs } from '../configs/models/config';
import { locks } from '../locks/models/lock';

export type DbConfig = {
  enableSslAuth: boolean;
  sslPaths: { ca: string; cert: string; key: string };
} & PoolConfig;

export function createConnectionOptions(dbConfig: DbConfig): PoolConfig {
  const { enableSslAuth, sslPaths, ...dataSourceOptions } = dbConfig;
  dataSourceOptions.application_name = `${hostname()}-${process.env.NODE_ENV ?? 'unknown_env'}`;
  if (enableSslAuth) {
    dataSourceOptions.password = undefined;
    dataSourceOptions.ssl = { key: readFileSync(sslPaths.key), cert: readFileSync(sslPaths.cert), ca: readFileSync(sslPaths.ca) };
  }
  return {
    ...dataSourceOptions,
  };
}

export interface InitConnectionOptions {
  /**
   * Called when a pooled connection fails outside of a query, for example when the database restarts,
   * fails over, or terminates the session (`pg_terminate_backend`, `idle_in_transaction_session_timeout`).
   * The pool discards the broken connection and opens a new one on demand, so this is for reporting only.
   */
  onError?: (err: Error) => void;
}

/**
 * Creates and verifies a connected `pg.Pool`.
 * The pool and every connection it opens get an `'error'` listener, so a connection that the database
 * drops does not crash the process with an unhandled `'error'` event.
 */
export async function initConnection(dbConfig: PoolConfig, options: InitConnectionOptions = {}): Promise<Pool> {
  const { onError = (): void => undefined } = options;
  const pool = new Pool(dbConfig);

  // Every connection error, idle or checked out, reaches the connection's own listener.
  pool.on('connect', (client) =>
    client.on('error', (err) => {
      try {
        onError(err);
      } catch {
        // onError is for reporting only; a throwing reporter must not crash the process
      }
    })
  );
  // The pool re-emits errors of idle connections, which were already reported above.
  pool.on('error', () => undefined);

  try {
    await pool.query('SELECT NOW()');
  } catch (err) {
    // A failing cleanup must not replace the original connection error
    await pool.end().catch(() => undefined);
    throw err;
  }
  return pool;
}

export type Drizzle = ReturnType<typeof createDrizzle>;

export function createDrizzle(pool: Pool): ReturnType<typeof drizzle<{ configs: typeof configs; locks: typeof locks }>> {
  return drizzle(pool, {
    schema: {
      configs,
      locks,
    },
  });
}

// maybe we should test migrations as well. for now, we'll just ignore them
/* istanbul ignore next */
export async function runMigrations(drizzle: Drizzle): Promise<void> {
  const optionalFolders = ['./src/db/migrations', './db/migrations', './migrations'];
  let migrationsFolder: string | null = null;

  for (const folder of optionalFolders) {
    if (existsSync(join(folder, '/meta/_journal.json'))) {
      migrationsFolder = folder;
      break;
    }
  }

  if (migrationsFolder === null) {
    throw new Error('No migrations folder found');
  }

  await migrate(drizzle, { migrationsFolder: migrationsFolder, migrationsSchema: 'config_server' });
}
