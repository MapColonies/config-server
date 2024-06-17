import { integer, jsonb, pgSchema, text, timestamp, primaryKey, foreignKey, index } from 'drizzle-orm/pg-core';

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

export const configsRefs = pgDbSchema.table(
  'config_refs',
  {
    configName: text('name').notNull(),
    version: integer('version').notNull(),
    refConfigName: text('ref_name').notNull(),
    refVersion: integer('ref_version'),
  },
  (table) => ({
    originalConfigRef: foreignKey({
      columns: [table.configName, table.version],
      foreignColumns: [configs.configName, configs.version],
      name: 'config_refs_original_config_fk',
    }),
    childConfigRef: foreignKey({
      columns: [table.refConfigName, table.refVersion],
      foreignColumns: [configs.configName, configs.version],
      name: 'config_refs_child_config_fk',
    }),
    index: index('idx_config_name_version').on(table.configName, table.version),
  })
);

export type Config = typeof configs.$inferSelect;
export type NewConfig = typeof configs.$inferInsert;

export type ConfigRef = typeof configsRefs.$inferSelect;
export type NewConfigRef = typeof configsRefs.$inferInsert;
