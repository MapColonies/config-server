import { HealthCheck } from '@godaddy/terminus';
import { sql } from 'drizzle-orm';
import { promiseTimeout } from '@src/common/utils/promiseTimeout';
import { Drizzle } from './createConnection';

export const healthCheck = (drizzle: Drizzle, timeoutMs: number): HealthCheck => {
  return async (): Promise<void> => {
    const promise = drizzle.execute(sql`select 1`);
    await promiseTimeout<Awaited<typeof promise>>(timeoutMs, promise);
  };
};
