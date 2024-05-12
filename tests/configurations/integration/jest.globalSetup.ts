import config from 'config';
import { runMigrations, createConnectionOptions, createDrizzle, initConnection } from '../../../src/db/createConnection';

export default async function globalSetup(): Promise<void> {
  const pool = await initConnection(createConnectionOptions(config.get('db')));
  const drizzle = createDrizzle(pool);
  await runMigrations(drizzle);
  await pool.end();
}
