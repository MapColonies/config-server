import crypto from 'node:crypto';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import stringify from 'fast-json-stable-stringify';
import { SERVICES } from '@common/constants';
import { setSpanAttributes } from '@common/tracing';
import { ConfigRepository, ConfigRefResponse, ConfigHashUpdate } from '../repositories/configRepository';
import { ConfigReference } from './configReference';
import { Config } from './config';

/**
 * Creates a unique cache key for a config based on its name, schema, and version.
 * This key is used for caching and deduplication during hash propagation.
 */
export function getConfigCacheKey(config: { configName: string; schemaId: string; version: number | string }): string {
  return `${config.configName}::${config.schemaId}::${config.version}`;
}

/**
 * Helper class for hash propagation operations.
 * Encapsulates logic for fetching refs, calculating hashes, and updating cache.
 */
@injectable()
export class HashPropagationHelper {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(ConfigRepository) private readonly configRepository: ConfigRepository
  ) {}

  /**
   * Collects all unique refs from a list of parent configs.
   * Returns a map of parent keys to their refs, and a deduplicated set of all refs.
   */
  public collectRefsFromParents(
    parentsAtLevel: Config[],
    listConfigRefsFn: (config: Config['config']) => ConfigReference[]
  ): {
    parentRefMap: Map<string, ConfigReference[]>;
    uniqueRefs: Map<string, ConfigReference>;
  } {
    const uniqueRefs = new Map<string, ConfigReference>();
    const parentRefMap = new Map<string, ConfigReference[]>();

    for (const parent of parentsAtLevel) {
      const parentRefs = listConfigRefsFn(parent.config);
      const parentKey = getConfigCacheKey(parent);
      parentRefMap.set(parentKey, parentRefs);

      for (const ref of parentRefs) {
        const refKey = getConfigCacheKey(ref);
        if (!uniqueRefs.has(refKey)) {
          uniqueRefs.set(refKey, ref);
        }
      }
    }

    return { parentRefMap, uniqueRefs };
  }

  /**
   * Fetches refs needed for parent configs at this level and adds them to cache.
   * Returns a map of parent keys to their config references.
   */
  public async fetchAndCacheRefsForParents(
    currentDepth: number,
    parentsAtLevel: Config[],
    resolvedRefsCache: Map<string, ConfigRefResponse>,
    listConfigRefsFn: (config: Config['config']) => ConfigReference[]
  ): Promise<Map<string, ConfigReference[]>> {
    // Collect all unique refs needed for this level
    const { parentRefMap, uniqueRefs } = this.collectRefsFromParents(parentsAtLevel, listConfigRefsFn);

    // Filter out refs already in cache
    const refsToFetch = this.filterCachedRefs(uniqueRefs, resolvedRefsCache);

    // Fetch any refs not already in cache
    if (refsToFetch.length > 0) {
      this.logger.debug({ depth: currentDepth, refCount: refsToFetch.length, msg: 'Fetching refs not in cache' });
      const fetchedRefs = await this.configRepository.getConfigRefs(refsToFetch);

      // Add to cache
      this.addRefsToCache(fetchedRefs, resolvedRefsCache);
    }

    return parentRefMap;
  }

  /**
   * Calculates new hashes for all parent configs and updates the cache with new hashes.
   * Returns array of hash updates that need to be persisted to the database.
   */
  public calculateHashUpdatesForParents(
    currentDepth: number,
    parentsAtLevel: Config[],
    parentRefMap: Map<string, ConfigReference[]>,
    resolvedRefsCache: Map<string, ConfigRefResponse>,
    calculateHashFn: (config: Config['config'], refs: ConfigReference[], resolvedRefs: ConfigRefResponse[]) => string
  ): (ConfigHashUpdate & { oldHash: string })[] {
    const hashUpdates: (ConfigHashUpdate & { oldHash: string })[] = [];

    for (const parent of parentsAtLevel) {
      const parentKey = getConfigCacheKey(parent);
      const parentRefs = parentRefMap.get(parentKey)!;

      // Resolve refs from cache
      const { resolved: resolvedParentRefs, missing } = this.resolveRefsFromCache(parentRefs, resolvedRefsCache);

      // Log warnings for missing refs
      for (const ref of missing) {
        this.logger.warn({ ref, msg: 'Could not resolve ref from cache' });
      }

      // Calculate new hash
      const newHash = calculateHashFn(parent.config, parentRefs, resolvedParentRefs);

      // Only update if hash actually changed
      const hashUpdate = this.createHashUpdateIfChanged(parent, newHash);

      if (hashUpdate) {
        this.logger.debug({
          depth: currentDepth,
          parentConfigName: parent.configName,
          parentVersion: parent.version,
          oldHash: hashUpdate.oldHash,
          newHash,
          msg: 'Parent hash changed, queuing update',
        });

        hashUpdates.push(hashUpdate);

        // CRITICAL: Update cache immediately so next depth level uses the new hash
        this.updateCacheWithNewHash(parent, newHash, resolvedRefsCache);
      } else {
        this.logger.debug({
          depth: currentDepth,
          parentConfigName: parent.configName,
          parentVersion: parent.version,
          msg: 'Parent hash unchanged, skipping',
        });
      }
    }

    return hashUpdates;
  }

  /**
   * Calculates a deterministic hash for a config based on its body and dependency hashes.
   * Uses Merkle-tree approach where parent hashes depend on child hashes.
   */
  public calculateConfigHash(config: Config['config'], refs: ConfigReference[], resolvedRefs: ConfigRefResponse[]): string {
    // Step 1: Create stable JSON representation of config body
    const configBodyString = stringify(config);

    // Step 2: Build map of resolved dependency hashes
    // For each ref, find the matching resolved ref (handling 'latest' version)
    const dependencyHashes: string[] = [];
    for (const ref of refs) {
      // Find matching resolved ref
      const resolved = resolvedRefs.find(
        (r) => r.configName === ref.configName && r.schemaId === ref.schemaId && (ref.version === 'latest' ? r.isLatest : r.version === ref.version)
      );

      if (resolved) {
        dependencyHashes.push(resolved.hash);
      }
    }
    dependencyHashes.sort(); // Ensure deterministic ordering

    // Combine config body with sorted dependency hashes
    const combinedString = configBodyString + dependencyHashes.join('');

    // Step 4: Calculate SHA256 hash
    const hash = crypto.createHash('sha256').update(combinedString).digest('hex');

    this.logger.debug({ hash, dependencyCount: dependencyHashes.length, msg: 'Calculated config hash' });
    setSpanAttributes({ configHash: hash, dependencyHashCount: dependencyHashes.length });

    return hash;
  }

  /**
   * Resolves config references from the cache, handling 'latest' version lookups.
   */
  private resolveRefsFromCache(
    refs: ConfigReference[],
    resolvedRefsCache: Map<string, ConfigRefResponse>
  ): { resolved: ConfigRefResponse[]; missing: ConfigReference[] } {
    const resolved: ConfigRefResponse[] = [];
    const missing: ConfigReference[] = [];

    for (const ref of refs) {
      const cacheKey = getConfigCacheKey(ref);
      let resolvedRef = resolvedRefsCache.get(cacheKey);

      // If ref.version is 'latest', find the matching config marked as latest
      if (!resolvedRef && ref.version === 'latest') {
        for (const [, cachedRef] of resolvedRefsCache) {
          if (cachedRef.configName === ref.configName && cachedRef.schemaId === ref.schemaId && cachedRef.isLatest) {
            resolvedRef = cachedRef;
            break;
          }
        }
      }

      if (resolvedRef) {
        resolved.push(resolvedRef);
      } else {
        missing.push(ref);
      }
    }

    return { resolved, missing };
  }

  /**
   * Updates the cache with the newly calculated hash for a parent config.
   * This ensures that configs at deeper levels use the updated hash.
   */
  private updateCacheWithNewHash(parent: Config, newHash: string, resolvedRefsCache: Map<string, ConfigRefResponse>): void {
    const cacheKey = getConfigCacheKey(parent);
    const cachedRef = resolvedRefsCache.get(cacheKey);

    if (cachedRef) {
      cachedRef.hash = newHash;
    } else {
      // Add to cache if not present
      resolvedRefsCache.set(cacheKey, {
        config: parent.config,
        configName: parent.configName,
        schemaId: parent.schemaId,
        version: parent.version,
        hash: newHash,
        isLatest: parent.isLatest,
      });
    }
  }

  /**
   * Checks if a hash has changed and returns an update object if needed.
   */
  private createHashUpdateIfChanged(parent: Config, newHash: string): (ConfigHashUpdate & { oldHash: string }) | null {
    if (newHash !== parent.hash) {
      return {
        configName: parent.configName,
        schemaId: parent.schemaId,
        version: parent.version,
        hash: newHash,
        oldHash: parent.hash,
      };
    }
    return null;
  }

  /**
   * Filters out refs that are already in the cache.
   */
  private filterCachedRefs(allRefs: Map<string, ConfigReference>, resolvedRefsCache: Map<string, ConfigRefResponse>): ConfigReference[] {
    const refsToFetch: ConfigReference[] = [];

    for (const [refKey, ref] of allRefs) {
      if (!resolvedRefsCache.has(refKey)) {
        refsToFetch.push(ref);
      }
    }

    return refsToFetch;
  }

  /**
   * Adds fetched refs to the cache.
   */
  private addRefsToCache(fetchedRefs: ConfigRefResponse[], resolvedRefsCache: Map<string, ConfigRefResponse>): void {
    for (const resolved of fetchedRefs) {
      const key = getConfigCacheKey(resolved);
      resolvedRefsCache.set(key, resolved);
    }
  }
}

/**
 * Collects all unique refs from a list of parent configs.
 * Returns a map of parent keys to their refs, and a deduplicated set of all refs.
 */
export function collectRefsFromParents(
  parentsAtLevel: Config[],
  listConfigRefsFn: (config: Config['config']) => ConfigReference[]
): {
  parentRefMap: Map<string, ConfigReference[]>;
  uniqueRefs: Map<string, ConfigReference>;
} {
  const uniqueRefs = new Map<string, ConfigReference>();
  const parentRefMap = new Map<string, ConfigReference[]>();

  for (const parent of parentsAtLevel) {
    const parentRefs = listConfigRefsFn(parent.config);
    const parentKey = getConfigCacheKey(parent);
    parentRefMap.set(parentKey, parentRefs);

    for (const ref of parentRefs) {
      const refKey = getConfigCacheKey(ref);
      if (!uniqueRefs.has(refKey)) {
        uniqueRefs.set(refKey, ref);
      }
    }
  }

  return { parentRefMap, uniqueRefs };
}

/**
 * Filters out refs that are already in the cache.
 */
export function filterCachedRefs(allRefs: Map<string, ConfigReference>, resolvedRefsCache: Map<string, ConfigRefResponse>): ConfigReference[] {
  const refsToFetch: ConfigReference[] = [];

  for (const [refKey, ref] of allRefs) {
    if (!resolvedRefsCache.has(refKey)) {
      refsToFetch.push(ref);
    }
  }

  return refsToFetch;
}

/**
 * Adds fetched refs to the cache.
 */
export function addRefsToCache(fetchedRefs: ConfigRefResponse[], resolvedRefsCache: Map<string, ConfigRefResponse>): void {
  for (const resolved of fetchedRefs) {
    const key = getConfigCacheKey(resolved);
    resolvedRefsCache.set(key, resolved);
  }
}

/**
 * Resolves config references from the cache, handling 'latest' version lookups.
 */
export function resolveRefsFromCache(
  refs: ConfigReference[],
  resolvedRefsCache: Map<string, ConfigRefResponse>
): { resolved: ConfigRefResponse[]; missing: ConfigReference[] } {
  const resolved: ConfigRefResponse[] = [];
  const missing: ConfigReference[] = [];

  for (const ref of refs) {
    const cacheKey = getConfigCacheKey(ref);
    let resolvedRef = resolvedRefsCache.get(cacheKey);

    // If ref.version is 'latest', find the matching config marked as latest
    if (!resolvedRef && ref.version === 'latest') {
      for (const [, cachedRef] of resolvedRefsCache) {
        if (cachedRef.configName === ref.configName && cachedRef.schemaId === ref.schemaId && cachedRef.isLatest) {
          resolvedRef = cachedRef;
          break;
        }
      }
    }

    if (resolvedRef) {
      resolved.push(resolvedRef);
    } else {
      missing.push(ref);
    }
  }

  return { resolved, missing };
}

/**
 * Updates the cache with the newly calculated hash for a parent config.
 * This ensures that configs at deeper levels use the updated hash.
 */
export function updateCacheWithNewHash(parent: Config, newHash: string, resolvedRefsCache: Map<string, ConfigRefResponse>): void {
  const cacheKey = getConfigCacheKey(parent);
  const cachedRef = resolvedRefsCache.get(cacheKey);

  if (cachedRef) {
    cachedRef.hash = newHash;
  } else {
    // Add to cache if not present
    resolvedRefsCache.set(cacheKey, {
      config: parent.config,
      configName: parent.configName,
      schemaId: parent.schemaId,
      version: parent.version,
      hash: newHash,
      isLatest: parent.isLatest,
    });
  }
}

/**
 * Checks if a hash has changed and returns an update object if needed.
 */
export function createHashUpdateIfChanged(parent: Config, newHash: string): (ConfigHashUpdate & { oldHash: string }) | null {
  if (newHash !== parent.hash) {
    return {
      configName: parent.configName,
      schemaId: parent.schemaId,
      version: parent.version,
      hash: newHash,
      oldHash: parent.hash,
    };
  }
  return null;
}
