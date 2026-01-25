import config from 'config';
import { runMigrations, createConnectionOptions, createDrizzle, initConnection } from '../../src/db/createConnection';

export async function setup(): Promise<void> {
  const pool = await initConnection(createConnectionOptions(config.get('db')));
  const drizzle = createDrizzle(pool);
  await runMigrations(drizzle);
  await pool.end();
}

export async function teardown(): Promise<void> {
  const pool = await initConnection(createConnectionOptions(config.get('db')));
  await pool.query('DROP SCHEMA IF EXISTS config_server CASCADE');
  await pool.end();
}
