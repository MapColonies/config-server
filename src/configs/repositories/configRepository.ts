import { SQLWrapper, and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { inject, scoped, Lifecycle } from 'tsyringe';
import { toDate } from 'date-fns-tz';
import { type Logger } from '@map-colonies/js-logger';
import type { Drizzle } from '@db';
import { SERVICES } from '@common/constants';
import { callWithSpan, withSpan } from '@common/tracing';
import { type Config, type NewConfig, type NewConfigRef, configs, configsRefs, SortOption } from '../models/config';
import type { ConfigReference } from '../models/configReference';
import { ConfigNotFoundError } from '../models/errors';

const DEFAULT_LIMIT = 10;
const DEFAULT_OFFSET = 0;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function recursiveQueryBuilder(drizzle: Drizzle, baseQuery: SQLWrapper, recursiveSelectParameters: Parameters<typeof drizzle.select>[0]) {
  return callWithSpan(() => {
    const recursiveQuery = drizzle
      .select(recursiveSelectParameters)
      .from(sql`rec`)
      .innerJoin(
        configsRefs,
        and(
          eq(configsRefs.configName, sql`rec."configName"`),
          eq(configsRefs.version, sql`rec."version"`),
          eq(configsRefs.schemaId, sql`rec."schemaId"`)
        )
      )
      .innerJoin(
        configs,
        and(
          eq(configsRefs.refConfigName, configs.configName),
          eq(configsRefs.refSchemaId, configs.schemaId),
          or(eq(configs.version, configsRefs.refVersion), and(isNull(configsRefs.refVersion), eq(configs.isLatest, true)))
        )
      );

    return sql`
      WITH RECURSIVE
        BASE_QUERY AS ${baseQuery},
        REC AS (
          SELECT
            *
          FROM
            BASE_QUERY
          UNION
          ${recursiveQuery}
        )
      SELECT
        *
      FROM
        REC
    `;
  }, 'recursiveQueryBuilder');
}

export interface ConfigSearchParams {
  q?: string;
  version?: number | 'latest';
  limit?: number;
  schemaId?: string;
  createdAtGt?: Date;
  createdAtLt?: Date;
  createdBy?: string;
  configName?: string;
  configSchemaVersion?: string;
}

export interface SqlPaginationParams {
  limit?: number;
  offset?: number;
}

export type ConfigRefResponse = Pick<Config, 'config' | 'configName' | 'version' | 'schemaId' | 'hash'> & {
  isLatest: boolean;
};

export type ConfigHashUpdate = Pick<Config, 'configName' | 'schemaId' | 'version' | 'hash'>;

export type ConfigWithDepth = Config & {
  depth: number;
};

@scoped(Lifecycle.ContainerScoped)
export class ConfigRepository {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.DRIZZLE) private readonly drizzle: Drizzle
  ) {}

  @withSpan()
  public async getAllConfigRefs(refs: ConfigReference[]): Promise<ConfigRefResponse[]> {
    this.logger.debug({ refCount: refs.length, msg: 'Retrieving all config references' });
    const refsForSql = refs.map((ref) => ({
      configName: ref.configName,
      version: ref.version === 'latest' ? null : ref.version,
      schemaId: ref.schemaId,
    }));
    // query to transform the input into a postgresql recordset so it can be joined with the data
    const inputCTE = sql`
      SELECT
        *
      FROM
        jsonb_to_recordset(${JSON.stringify(refsForSql)}) AS x ("configName" text, "version" int, "schemaId" text)
    `;

    // this query selects all the references requested by the input
    const baseQuery = this.drizzle
      .select({
        inputName: sql`input."configName" AS "inputConfigName"`,
        inputVersion: sql`input."version" AS "inputVersion"`,
        inputSchemaId: sql`input."schemaId" AS "inputSchemaId"`,
        name: sql`${configs.configName} AS "configName"`,
        version: configs.version,
        schemaId: sql`${configs.schemaId} AS "schemaId"`,
        config: configs.config,
        hash: configs.hash,
        isLatest: sql`
          CASE
            WHEN input."version" IS NULL THEN TRUE
            ELSE FALSE
          END AS "isLatest"
        `,
      })
      .from(sql`(${inputCTE}) AS INPUT`)
      .leftJoin(
        configs,
        and(
          eq(configs.configName, sql`input."configName"`),
          eq(configs.schemaId, sql`input."schemaId"`),
          or(eq(configs.version, sql`input."version"`), and(isNull(sql`input."version"`), eq(configs.isLatest, true)))
        )
      );

    // this query is the recursive query that will fetch the references of the requested references
    const recursiveQuery = recursiveQueryBuilder(this.drizzle, baseQuery, {
      inputName: sql`NULL`,
      inputVersion: sql`NULL`,
      inputSchemaId: sql`NULL`,
      name: configs.configName,
      version: configs.version,
      schemaId: configs.schemaId,
      config: configs.config,
      hash: configs.hash,
      isLatest: sql`
        CASE
          WHEN ${configsRefs.refVersion} IS NULL THEN TRUE
          ELSE FALSE
        END AS "isLatest"
      `,
    });

    const res = await this.drizzle.execute<
      {
        inputConfigName: string | null;
        inputVersion: number | null;
        configName: string | null;
        isLatest: boolean;
        schemaId: string | null;
        hash: string | null;
      } & Pick<Config, 'config' | 'version' | 'schemaId'>
    >(recursiveQuery);
    const returnValue: Awaited<ReturnType<typeof this.getAllConfigRefs>> = [];

    for (const row of res.rows) {
      if (row.configName === null) {
        throw new ConfigNotFoundError(
          `no matching config was found for the following reference: ${row.inputConfigName ?? ''} ${row.inputVersion ?? 'latest'} ${row.schemaId}`
        );
      }
      returnValue.push({
        config: row.config,
        configName: row.configName,
        version: row.version,
        isLatest: row.isLatest,
        schemaId: row.schemaId,
        hash: row.hash ?? '',
      });
    }

    return returnValue;
  }

  /**
   * Retrieves config references without recursion (only one level deep).
   * More efficient than getAllConfigRefs when you don't need nested references.
   * @param refs - The config references to retrieve
   * @returns A Promise that resolves to an array of config references (non-recursive)
   */
  @withSpan()
  public async getConfigRefs(refs: ConfigReference[]): Promise<ConfigRefResponse[]> {
    this.logger.debug({ refCount: refs.length, msg: 'Retrieving config references (non-recursive)' });
    const refsForSql = refs.map((ref) => ({
      configName: ref.configName,
      version: ref.version === 'latest' ? null : ref.version,
      schemaId: ref.schemaId,
    }));

    const inputCTE = sql`
      SELECT *
      FROM jsonb_to_recordset(${JSON.stringify(refsForSql)}) AS x ("configName" text, "version" int, "schemaId" text)
    `;

    const query = this.drizzle
      .select({
        configName: configs.configName,
        version: configs.version,
        schemaId: configs.schemaId,
        config: configs.config,
        hash: configs.hash,
        isLatest: sql<boolean>`
          CASE
            WHEN input."version" IS NULL THEN TRUE
            ELSE FALSE
          END
        `,
      })
      .from(sql`(${inputCTE}) AS input`)
      .innerJoin(
        configs,
        and(
          eq(configs.configName, sql`input."configName"`),
          eq(configs.schemaId, sql`input."schemaId"`),
          or(eq(configs.version, sql`input."version"`), and(isNull(sql`input."version"`), eq(configs.isLatest, true)))
        )
      );

    const res = await query.execute();

    if (res.length !== refs.length) {
      // Some configs were not found - need to identify which ones
      const foundKeys = new Set(res.map((r) => `${r.configName}:${r.schemaId}:${r.version}`));
      const missingRef = refs.find((ref) => {
        const version = ref.version === 'latest' ? 'latest' : ref.version;
        return (
          !foundKeys.has(`${ref.configName}:${ref.schemaId}:${version}`) &&
          !res.some((r) => r.configName === ref.configName && r.schemaId === ref.schemaId && r.isLatest && ref.version === 'latest')
        );
      });

      if (missingRef) {
        throw new ConfigNotFoundError(
          `no matching config was found for the following reference: ${missingRef.configName} ${missingRef.version} ${missingRef.schemaId}`
        );
      }
    }

    return res.map((row) => ({
      config: row.config,
      configName: row.configName,
      version: row.version,
      isLatest: row.isLatest,
      schemaId: row.schemaId,
      hash: row.hash,
    }));
  }

  /**
   * Creates a new configuration with the provided data.
   * @param config - The configuration data to be created.
   * @returns A Promise that resolves when the configuration is created.
   */
  @withSpan()
  public async createConfig(config: Omit<NewConfig, 'createdAt' | 'isLatest'> & { refs: ConfigReference[] }): Promise<void> {
    const { refs, ...configData } = config;
    const dbRefs = config.refs.map<NewConfigRef>((ref) => ({
      configName: config.configName,
      version: config.version,
      schemaId: config.schemaId,
      refConfigName: ref.configName,
      refVersion: ref.version === 'latest' ? null : ref.version,
      refSchemaId: ref.schemaId,
    }));

    await this.drizzle.transaction(async (tx) => {
      this.logger.debug('Inserting the config into the database');
      await tx
        .insert(configs)
        .values({ ...configData, isLatest: true })
        .execute();

      if (dbRefs.length > 0) {
        this.logger.debug('Inserting the config references into the database');
        await tx.insert(configsRefs).values(dbRefs).execute();
      }

      // set the previous version of the config to not be the latest if a previous version exists
      if (config.version !== 1) {
        this.logger.debug('Setting the previous version of the config to not be the latest');
        await tx
          .update(configs)
          .set({ isLatest: false })
          .where(and(eq(configs.configName, config.configName), eq(configs.version, config.version - 1), eq(configs.schemaId, config.schemaId)))
          .execute();
      }
    });
  }

  /**
   * Retrieves a configuration by name and version.
   * If the version is not provided, the latest version will be retrieved.
   * @param name - The name of the configuration.
   * @param version - The version of the configuration (optional).
   * @returns A Promise that resolves to the retrieved configuration, or undefined if not found.
   */
  @withSpan()
  public async getConfig(name: string, schemaId: string, version?: number): Promise<Config | undefined> {
    this.logger.debug('Retrieving the config from the database without resolving references');
    const comparators = [eq(configs.configName, name), eq(configs.schemaId, schemaId)];

    if (version !== undefined) {
      comparators.push(eq(configs.version, version));
    } else {
      comparators.push(eq(configs.isLatest, true));
    }

    const config = await this.drizzle
      .select()
      .from(configs)
      .where(and(...comparators))
      .execute();

    if (config.length === 0) {
      return undefined;
    }
    return config[0];
  }

  /**
   * Retrieves a configuration recursively by name and version.
   * @param name - The name of the configuration.
   * @param version - The version of the configuration (optional).
   * @returns A promise that resolves to an array containing the configuration and its references, or undefined if not found.
   */
  @withSpan()
  public async getConfigRecursive(name: string, schemaId: string, version?: number): Promise<[Config, ConfigRefResponse[]] | undefined> {
    this.logger.debug('Retrieving config and its references from the database');
    // const maxVersion = maxVersionQueryBuilder(this.drizzle, name);

    const versionOperator = version !== undefined ? eq(configs.version, version) : eq(configs.isLatest, true);

    // this query select the config that matches the name and version specified
    const baseQuery = this.drizzle
      .select({
        configName: sql`${configs.configName} AS "configName"`,
        version: configs.version,
        config: configs.config,
        schemaId: sql`${configs.schemaId} AS "schemaId"`,
        createdAt: sql`${configs.createdAt} AS "createdAt"`,
        createdBy: sql`${configs.createdBy} AS "createdBy"`,
        isLatest: sql`${configs.isLatest} AS "isLatest"`,
        configSchemaVersion: sql`${configs.configSchemaVersion} AS "configSchemaVersion"`,
        hash: sql`${configs.hash} AS "hash"`,
      })
      .from(configs)
      .where(and(eq(configs.configName, name), versionOperator, eq(configs.schemaId, schemaId)));

    // this query is the recursive query that will fetch the references of the config
    const recursiveQuery = recursiveQueryBuilder(this.drizzle, baseQuery, {
      configName: configs.configName,
      version: configs.version,
      config: configs.config,
      schemaId: configs.schemaId,
      createdAt: sql`NULL`,
      createdBy: sql`NULL`,
      isLatest: sql`
        CASE
          WHEN ${configsRefs.refVersion} IS NULL THEN TRUE
          ELSE FALSE
        END AS "isLatest"
      `,
      configSchemaVersion: configs.configSchemaVersion,
      hash: configs.hash,
    });

    const res = await this.drizzle.execute<Omit<Config, 'createdAt'> & { createdAt: string }>(recursiveQuery);

    const configResult = res.rows.shift();
    if (!configResult) {
      this.logger.debug('No config found with the specified name and version');
      return undefined;
    }

    const config = {
      configName: configResult.configName,
      schemaId: configResult.schemaId,
      version: configResult.version,
      config: configResult.config,
      createdAt: toDate(configResult.createdAt, { timeZone: 'UTC' }),
      createdBy: configResult.createdBy,
      isLatest: configResult.isLatest,
      configSchemaVersion: configResult.configSchemaVersion,
      hash: configResult.hash,
    };
    const refs = res.rows.map((row) => ({
      config: row.config,
      configName: row.configName,
      version: row.version,
      schemaId: row.schemaId,
      isLatest: row.isLatest,
      hash: row.hash,
    }));

    return [config, refs];
  }

  /**
   * Retrieves configurations based on the provided search parameters and pagination options.
   * @param searchParams - The search parameters to filter the configurations.
   * @param paginationParams - The pagination options for the query (default: { limit: 1, offset: 0 }).
   * @returns A promise that resolves to an object containing the retrieved configurations and the total count.
   */
  @withSpan()
  public async getConfigs(
    searchParams: ConfigSearchParams,
    paginationParams: SqlPaginationParams = { limit: 1, offset: 0 },
    sortingParams: SortOption[] = []
  ): Promise<{ configs: Config[]; totalCount: number }> {
    this.logger.debug('Retrieving configs with filters from the database');
    const filterParams: SQLWrapper[] = this.getFilterParams(searchParams);

    const orderByParams = sortingParams.map((sort) => (sort.order === 'asc' ? asc(configs[sort.field]) : desc(configs[sort.field])));

    const configsQuery = this.drizzle
      .select({
        configName: configs.configName,
        schemaId: configs.schemaId,
        version: configs.version,
        config: configs.config,
        createdAt: configs.createdAt,
        createdBy: configs.createdBy,
        isLatest: configs.isLatest,
        configSchemaVersion: configs.configSchemaVersion,
        hash: configs.hash,
        totalCount: sql<string>`count(*) OVER ()`,
      })
      .from(configs)
      .where(and(...filterParams))
      .offset(paginationParams.offset ?? DEFAULT_OFFSET)
      .limit(paginationParams.limit ?? DEFAULT_LIMIT)
      .orderBy(...orderByParams);

    const configsResult = await configsQuery.execute();

    if (!configsResult[0]) {
      this.logger.debug('No configs found with the specified filters');
      return { configs: [], totalCount: 0 };
    }

    const totalCount = parseInt(configsResult[0].totalCount);

    const mappedConfig = configsResult.map((config) => ({
      configName: config.configName,
      schemaId: config.schemaId,
      version: config.version,
      config: config.config,
      createdAt: config.createdAt,
      createdBy: config.createdBy,
      isLatest: config.isLatest,
      configSchemaVersion: config.configSchemaVersion,
      hash: config.hash,
    }));

    return { configs: mappedConfig, totalCount };
  }

  /**
   * Retrieves all parent configurations that reference the specified child config.
   * This is used for hash propagation - when a config changes, we need to update all parents.
   * Returns ALL versions of parent configs that might be affected, not just the latest.
   * @param childConfigName - The name of the child config
   * @param childSchemaId - The schema ID of the child config
   * @param childVersion - The version of the child config (optional, if not provided, finds parents referencing 'latest')
   * @returns A Promise that resolves to an array of parent configs (all versions)
   */
  @withSpan()
  public async getParentConfigs(childConfigName: string, childSchemaId: string, childVersion?: number): Promise<Config[]> {
    this.logger.debug({ childConfigName, childSchemaId, childVersion, msg: 'Finding parent configs that reference this child' });

    // Find all config_refs that point to this child config
    const parentRefs = await this.drizzle
      .select({
        configName: configsRefs.configName,
        schemaId: configsRefs.schemaId,
        version: configsRefs.version,
      })
      .from(configsRefs)
      .where(
        and(
          eq(configsRefs.refConfigName, childConfigName),
          eq(configsRefs.refSchemaId, childSchemaId),
          // Match either specific version or null (which means 'latest')
          childVersion !== undefined ? or(eq(configsRefs.refVersion, childVersion), isNull(configsRefs.refVersion)) : isNull(configsRefs.refVersion)
        )
      )
      .execute();

    if (parentRefs.length === 0) {
      return [];
    }

    // Fetch ALL parent config versions (not just latest)
    // Each row in parentRefs represents a specific version that references the child
    const parentConfigs: Config[] = [];
    for (const parentRef of parentRefs) {
      const parentConfig = await this.getConfig(parentRef.configName, parentRef.schemaId, parentRef.version);
      if (parentConfig) {
        parentConfigs.push(parentConfig);
      }
    }

    this.logger.debug({ parentCount: parentConfigs.length, msg: 'Found parent config versions' });
    return parentConfigs;
  }

  /**
   * Retrieves ALL parent configs in the entire dependency tree using a recursive CTE.
   * Returns parents with their depth level (distance from the child config).
   * This enables processing parents in correct topological order for hash propagation.
   *
   * @param childConfigName - The name of the child config
   * @param childSchemaId - The schema ID of the child config
   * @param childVersion - The version of the child config (optional)
   * @returns A Promise that resolves to an array of parent configs with depth information, ordered by depth
   */
  @withSpan()
  public async getAllParentConfigsRecursive(childConfigName: string, childSchemaId: string, childVersion?: number): Promise<ConfigWithDepth[]> {
    this.logger.debug({ childConfigName, childSchemaId, childVersion, msg: 'Finding all parent configs recursively with depth' });

    // Build recursive CTE to find all parents in the dependency tree
    // Level 1: Direct parents of the child
    // Level 2: Parents of level 1 (grandparents)
    // Level N: Continue until no more parents found
    const recursiveCTE = sql`
      WITH RECURSIVE parent_tree AS (
        -- Base case: Find direct parents of the child config
        SELECT DISTINCT
          c.name AS "configName",
          c.schema_id AS "schemaId",
          c.version,
          c.config,
          c.created_at AS "createdAt",
          c.created_by AS "createdBy",
          c.is_latest AS "isLatest",
          c.config_schema_version AS "configSchemaVersion",
          c.hash,
          1 AS depth
        FROM config_server.config_refs cr
        INNER JOIN config_server.config c
          ON cr.name = c.name 
          AND cr.schema_id = c.schema_id 
          AND cr.version = c.version
        WHERE cr.ref_name = ${childConfigName}
          AND cr.ref_schema_id = ${childSchemaId}
          AND (
            ${childVersion !== undefined ? sql`cr.ref_version = ${childVersion} OR cr.ref_version IS NULL` : sql`cr.ref_version IS NULL`}
          )
        
        UNION
        
        -- Recursive case: Find parents of parents
        SELECT DISTINCT
          c.name AS "configName",
          c.schema_id AS "schemaId",
          c.version,
          c.config,
          c.created_at AS "createdAt",
          c.created_by AS "createdBy",
          c.is_latest AS "isLatest",
          c.config_schema_version AS "configSchemaVersion",
          c.hash,
          pt.depth + 1
        FROM parent_tree pt
        INNER JOIN config_server.config_refs cr
          ON cr.ref_name = pt."configName"
          AND cr.ref_schema_id = pt."schemaId"
          AND (cr.ref_version = pt.version OR cr.ref_version IS NULL)
        INNER JOIN config_server.config c
          ON cr.name = c.name
          AND cr.schema_id = c.schema_id
          AND cr.version = c.version
      )
      SELECT * FROM parent_tree
      ORDER BY depth ASC, "configName" ASC, "schemaId" ASC, version ASC
    `;

    const result = await this.drizzle.execute<Omit<Config, 'createdAt'> & { createdAt: string; depth: number }>(recursiveCTE);

    const parentConfigs: ConfigWithDepth[] = result.rows.map((row) => ({
      configName: row.configName,
      schemaId: row.schemaId,
      version: row.version,
      config: row.config,
      createdAt: toDate(row.createdAt, { timeZone: 'UTC' }),
      createdBy: row.createdBy,
      isLatest: row.isLatest,
      configSchemaVersion: row.configSchemaVersion,
      hash: row.hash,
      depth: row.depth,
    }));

    this.logger.debug({
      parentCount: parentConfigs.length,
      maxDepth: parentConfigs.length > 0 ? Math.max(...parentConfigs.map((p) => p.depth)) : 0,
      msg: 'Found all parent configs recursively',
    });

    return parentConfigs;
  }

  /**
   * Updates the hash of a specific config version in-place.
   * Used for hash propagation when dependencies change.
   * @param configName - The name of the config
   * @param schemaId - The schema ID of the config
   * @param version - The version of the config
   * @param hash - The new hash value
   */
  @withSpan()
  public async updateConfigHash(configName: string, schemaId: string, version: number, hash: string): Promise<void> {
    this.logger.debug({ msg: 'Updating config hash in-place', configName, schemaId, version, hash });
    await this.drizzle
      .update(configs)
      .set({ hash })
      .where(and(eq(configs.configName, configName), eq(configs.schemaId, schemaId), eq(configs.version, version)))
      .execute();
  }

  /**
   * Batch updates hashes for multiple config versions in a single SQL statement.
   * Much more efficient than updating configs one by one.
   * @param updates - Array of config identifiers and their new hash values
   */
  @withSpan()
  public async updateConfigHashes(updates: ConfigHashUpdate[]): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    this.logger.debug({ updateCount: updates.length, msg: 'Batch updating config hashes' });

    // Build a SQL statement using CASE to update all hashes in one query
    // UPDATE configs SET hash = CASE
    //   WHEN (configName = 'x' AND schemaId = 'y' AND version = 1) THEN 'hash1'
    //   WHEN (configName = 'x' AND schemaId = 'y' AND version = 2) THEN 'hash2'
    //   ELSE hash
    // END
    // WHERE (configName, schemaId, version) IN (('x', 'y', 1), ('x', 'y', 2), ...)

    const caseConditions = updates.map(
      (u) =>
        sql`WHEN (${configs.configName} = ${u.configName} AND ${configs.schemaId} = ${u.schemaId} AND ${configs.version} = ${u.version}) THEN ${u.hash}`
    );

    const whereConditions = updates.map(
      (u) => sql`(${configs.configName}, ${configs.schemaId}, ${configs.version}) = (${u.configName}, ${u.schemaId}, ${u.version})`
    );

    await this.drizzle
      .update(configs)
      .set({
        hash: sql`CASE ${sql.join(caseConditions, sql.raw(' '))} ELSE ${configs.hash} END`,
      })
      .where(or(...whereConditions))
      .execute();

    this.logger.debug({ updateCount: updates.length, msg: 'Batch hash update completed' });
  }

  public async updateConfigToNewSchemaVersion(input: {
    configName: string;
    schemaId: string;
    version: number;
    newSchemaVersion: string;
    config: Record<string, unknown>;
  }): Promise<void> {
    const { configName, schemaId, version, newSchemaVersion } = input;
    this.logger.debug({ msg: 'Updating config to a new version', configName, schemaId, version, newSchemaVersion });
    await this.drizzle
      .update(configs)
      .set({ config: input.config, configSchemaVersion: newSchemaVersion })
      .where(and(eq(configs.configName, configName), eq(configs.schemaId, schemaId), eq(configs.version, version)))
      .execute();
  }

  private getFilterParams(searchParams: ConfigSearchParams): SQLWrapper[] {
    this.logger.debug('Building SQL filter params for the config search');
    const filterParams: SQLWrapper[] = [];

    if (searchParams.q !== undefined && searchParams.q !== '') {
      filterParams.push(sql`textsearchable_index_col @@ to_tsquery('english', ${searchParams.q})`);
    }

    if (searchParams.configName !== undefined) {
      filterParams.push(eq(configs.configName, searchParams.configName));
    }

    const version = parseInt(searchParams.version as string);
    if (Number.isInteger(version)) {
      filterParams.push(eq(configs.version, version));
    }

    if (searchParams.schemaId !== undefined) {
      filterParams.push(eq(configs.schemaId, searchParams.schemaId));
    }

    if (searchParams.createdAtGt !== undefined) {
      filterParams.push(gt(configs.createdAt, searchParams.createdAtGt));
    }

    if (searchParams.createdAtLt !== undefined) {
      filterParams.push(lt(configs.createdAt, searchParams.createdAtLt));
    }

    if (searchParams.createdBy !== undefined) {
      filterParams.push(eq(configs.createdBy, searchParams.createdBy));
    }

    if (searchParams.version === 'latest') {
      filterParams.push(eq(configs.isLatest, true));
    }

    if (searchParams.configSchemaVersion !== undefined) {
      filterParams.push(eq(configs.configSchemaVersion, searchParams.configSchemaVersion));
    }

    return filterParams;
  }
}
