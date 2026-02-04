/**
 * Pure utility functions for schema ID parsing and manipulation
 */

const NOT_FOUND_INDEX = -1;

/**
 * Extracts human-readable name from schema ID
 * Example: "https://mapcolonies.com/common/db/v1" → "common.db"
 */
export function extractNameFromSchemaId(schemaId: string): string {
  const parts = schemaId.replace('https://mapcolonies.com/', '').split('/');
  const EXCLUDE_LAST_ELEMENT = -1;
  return parts.slice(0, EXCLUDE_LAST_ELEMENT).join('.');
}

/**
 * Extracts version from schema ID
 * Example: "https://mapcolonies.com/common/db/v1" → "v1"
 */
export function extractVersionFromSchemaId(schemaId: string): string {
  const parts = schemaId.split('/');
  const lastIndex = parts.length + NOT_FOUND_INDEX;
  return parts[lastIndex] ?? 'v1';
}

/**
 * Extracts category from schema ID
 * Example: "https://mapcolonies.com/common/db/v1" → "common"
 */
export function extractCategoryFromSchemaId(schemaId: string): string {
  const parts = schemaId.replace('https://mapcolonies.com/', '').split('/');
  return parts[0] ?? 'unknown';
}
