import type { components, operations } from '@openapi';

// Re-export types from OpenAPI spec
export type SchemaReference = components['schemas']['schemaReference'];
export type SchemaIndexEntry = operations['getSchemasIndex']['responses']['200']['content']['application/json']['schemas'][number];
export type EnvVar = operations['getFullSchema']['responses']['200']['content']['application/json']['envVars'][number];
export type Dependencies = operations['getFullSchema']['responses']['200']['content']['application/json']['dependencies'];
export type FullSchemaMetadata = operations['getFullSchema']['responses']['200']['content']['application/json'];
