/**
 * Pure utility functions for calculating config statistics
 */

/**
 * Recursively counts all keys in an object
 */
export function countKeys(obj: unknown): number {
  if (typeof obj !== 'object' || obj === null) {
    return 0;
  }

  let count = 0;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      count += countKeys(item);
    }
  } else {
    for (const key in obj) {
      count++; // Count this key
      count += countKeys((obj as Record<string, unknown>)[key]);
    }
  }

  return count;
}

/**
 * Calculates maximum nesting depth of an object
 */
export function calculateDepth(obj: unknown, currentDepth: number = 0): number {
  if (typeof obj !== 'object' || obj === null) {
    return currentDepth;
  }

  let maxDepth = currentDepth;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      maxDepth = Math.max(maxDepth, calculateDepth(item, currentDepth + 1));
    }
  } else {
    for (const key in obj) {
      maxDepth = Math.max(maxDepth, calculateDepth((obj as Record<string, unknown>)[key], currentDepth + 1));
    }
  }

  return maxDepth;
}
