import { integer, jsonb, pgSchema, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const pgDbSchema = pgSchema('config_server');

export const configs = pgDbSchema.table(
  'config',
  {
    configName: text('name').notNull(),
    schemaId: text('schema_id').notNull(),
    version: integer('version').notNull(),
    config: jsonb('config').notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.configName, table.version] }),
  })
);

export type Config = typeof configs.$inferSelect;
export type NewConfig = typeof configs.$inferInsert;
