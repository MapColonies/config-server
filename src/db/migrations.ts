import { migrate } from 'drizzle-orm/node-postgres/migrator';
import config from 'config';
import { createConnectionOptions, initConnection, createDrizzle } from './createConnection';

(async (): Promise<void> => {
  const pool = await initConnection(createConnectionOptions(config.get('db')));
  await migrate(createDrizzle(pool), { migrationsFolder: './src/db/migrations' });
  await pool.end();
})().catch(console.error);
