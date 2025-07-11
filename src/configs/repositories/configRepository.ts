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

export type ConfigRefResponse = Pick<Config, 'config' | 'configName' | 'version' | 'schemaId'> & {
  isLatest: boolean;
};

@scoped(Lifecycle.ContainerScoped)
export class ConfigRepository {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.DRIZZLE) private readonly drizzle: Drizzle
  ) {}

  @withSpan()
  public async getAllConfigRefs(refs: ConfigReference[]): Promise<ConfigRefResponse[]> {
    this.logger.debug('Retrieving all config references', { refCount: refs.length });
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
      isLatest: sql`
        CASE
          WHEN ${configsRefs.refVersion} IS NULL THEN TRUE
          ELSE FALSE
        END AS "isLatest"
      `,
    });

    const res = await this.drizzle.execute<
      { inputConfigName: string | null; inputVersion: number | null; configName: string | null; isLatest: boolean; schemaId: string | null } & Pick<
        Config,
        'config' | 'version' | 'schemaId'
      >
    >(recursiveQuery);
    const returnValue: Awaited<ReturnType<typeof this.getAllConfigRefs>> = [];

    for (const row of res.rows) {
      if (row.configName === null) {
        throw new ConfigNotFoundError(
          `no matching config was found for the following reference: ${row.inputConfigName ?? ''} ${row.inputVersion ?? 'latest'} ${row.schemaId}`
        );
      }
      returnValue.push({ config: row.config, configName: row.configName, version: row.version, isLatest: row.isLatest, schemaId: row.schemaId });
    }

    return returnValue;
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
    };
    const refs = res.rows.map((row) => ({
      config: row.config,
      configName: row.configName,
      version: row.version,
      schemaId: row.schemaId,
      isLatest: row.isLatest,
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
    }));

    return { configs: mappedConfig, totalCount };
  }

  @withSpan()
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

  public async updateConfigToNewSchemaVersion(input: {
    configName: string;
    schemaId: string;
    version: number;
    newSchemaVersion: string;
    config: Record<string, unknown>;
  }): Promise<void> {
    const { configName, schemaId, version, newSchemaVersion } = input;
    this.logger.debug('Updating config to a new version', { configName, schemaId, version, newSchemaVersion });
    await this.drizzle
      .update(configs)
      .set({ config: input.config, configSchemaVersion: newSchemaVersion })
      .where(and(eq(configs.configName, configName), eq(configs.schemaId, schemaId), eq(configs.version, version)))
      .execute();
  }
}
