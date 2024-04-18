import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const configs = pgTable('config', {
  configName: text('name').notNull().primaryKey(),
  schemaId: text('schema_id').notNull(),
  version: text('version').notNull(),
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type Config = typeof configs.$inferSelect;
export type NewConfig = typeof configs.$inferInsert;