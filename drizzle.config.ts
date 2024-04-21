import { ConnectionConfig } from 'pg';
import type { Config as DrizzleConfig } from 'drizzle-kit';
import config from 'config';

import { createConnectionOptions } from './src/db/createConnection'

export default {
  schema: ['./src/configs/models/config.ts'],
  out: './src/db/migrations',
  driver: 'pg', // 'pg' | 'mysql2' | 'better-sqlite' | 'libsql' | 'turso'
  dbCredentials: createConnectionOptions(config.get('db')) as Required<ConnectionConfig> ,
} satisfies DrizzleConfig;