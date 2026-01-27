import { integer, jsonb, pgSchema, text, timestamp, primaryKey, foreignKey, index, boolean } from 'drizzle-orm/pg-core';

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
    isLatest: boolean('is_latest').notNull(),
    configSchemaVersion: text('config_schema_version').notNull().default('v2'),
    hash: text('hash').notNull(),
  },
  (table) => [primaryKey({ columns: [table.configName, table.schemaId, table.version] })]
);

export const configsRefs = pgDbSchema.table(
  'config_refs',
  {
    configName: text('name').notNull(),
    schemaId: text('schema_id').notNull(),
    version: integer('version').notNull(),
    refConfigName: text('ref_name').notNull(),
    refSchemaId: text('ref_schema_id').notNull(),
    refVersion: integer('ref_version'),
  },
  (table) => [
    foreignKey({
      columns: [table.configName, table.schemaId, table.version],
      foreignColumns: [configs.configName, configs.schemaId, configs.version],
      name: 'config_refs_original_config_fk',
    }),
    foreignKey({
      columns: [table.refConfigName, table.refSchemaId, table.refVersion],
      foreignColumns: [configs.configName, configs.schemaId, configs.version],
      name: 'config_refs_child_config_fk',
    }),
    index('idx_config_name_version').on(table.configName, table.version),
  ]
);

export type Config = typeof configs.$inferSelect;
export type NewConfig = typeof configs.$inferInsert;

export type ConfigRef = typeof configsRefs.$inferSelect;
export type NewConfigRef = typeof configsRefs.$inferInsert;

export type SortableFields = keyof Omit<Config, 'config'>;

export interface SortOption {
  field: SortableFields;
  order: 'asc' | 'desc';
}
