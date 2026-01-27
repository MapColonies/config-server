import { HealthCheck } from '@godaddy/terminus';
import { sql } from 'drizzle-orm';
import { promiseTimeout } from '@src/common/utils/promiseTimeout';
import { DB_CONNECTION_TIMEOUT } from '@src/common/constants';
import { Drizzle } from './createConnection';

export const healthCheck = (drizzle: Drizzle): HealthCheck => {
  return async (): Promise<void> => {
    const check = drizzle.execute(sql`select 1`).then(() => {});
    await promiseTimeout<void>(DB_CONNECTION_TIMEOUT, check);
  };
};
