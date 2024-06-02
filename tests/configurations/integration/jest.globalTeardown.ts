import config from 'config';
import { createConnectionOptions, initConnection } from '../../../src/db/createConnection';

export default async function globalSetup(): Promise<void> {
  const pool = await initConnection(createConnectionOptions(config.get('db')));
  await pool.query('DROP SCHEMA IF EXISTS config_server CASCADE');
  await pool.end();
}
