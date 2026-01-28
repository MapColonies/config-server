import { text, timestamp, primaryKey, integer } from 'drizzle-orm/pg-core';
import { pgDbSchema } from '../../db/schema';

export const locks = pgDbSchema.table(
  'locks',
  {
    key: text('key').notNull(),
    callerId: text('caller_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
    limit: integer('limit').notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.callerId] })]
);

export type Lock = typeof locks.$inferSelect;
export type NewLock = typeof locks.$inferInsert;
