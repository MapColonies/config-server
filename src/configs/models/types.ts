import type { components, operations } from '@openapi';

// Re-export types from OpenAPI spec
export type ConfigReference = components['schemas']['configReference'];
export type ConfigFullMetadata = operations['getFullConfig']['responses']['200']['content']['application/json'];
export type ConfigStats = components['schemas']['configStats'];
export type EnvVarWithValue = components['schemas']['envVarWithValue'];
export type VersionInfo = components['schemas']['versionInfo'];
