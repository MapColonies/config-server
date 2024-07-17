import { Logger, SQL, SQLWrapper, and, eq, gt, lt, sql, or, isNull } from 'drizzle-orm';
import { inject, scoped, Lifecycle } from 'tsyringe';
import { toDate } from 'date-fns-tz';
import { SERVICES } from '../../common/constants';
import type { Drizzle } from '../../db/createConnection';
import { type Config, type NewConfig, type NewConfigRef, configs, configsRefs } from '../models/config';
import type { ConfigReference } from '../models/configReference';
import { ConfigNotFoundError } from '../models/errors';

const DEFAULT_LIMIT = 10;
const DEFAULT_OFFSET = 0;

// eslint-disable-next-line @typescript-eslint/no-magic-numbers
function recursiveQueryBuilder(drizzle: Drizzle, baseQuery: SQLWrapper, recursiveSelectParameters: Parameters<typeof drizzle.select>[0]): SQL {
  const recursiveQuery = drizzle
    .select(recursiveSelectParameters)
    .from(sql`rec`)
    .innerJoin(configsRefs, and(eq(configsRefs.configName, sql`rec."configName"`), eq(configsRefs.version, sql`rec."version"`)))
    .innerJoin(
      configs,
      and(
        eq(configsRefs.refConfigName, configs.configName),
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
}

export interface SqlPaginationParams {
  limit?: number;
  offset?: number;
}

export type ConfigRefResponse = Pick<Config, 'config' | 'configName' | 'version'> & {
  isLatest: boolean;
};

@scoped(Lifecycle.ContainerScoped)
export class ConfigRepository {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.DRIZZLE) private readonly drizzle: Drizzle
  ) {}

  public async getAllConfigRefs(refs: ConfigReference[]): Promise<ConfigRefResponse[]> {
    const refsForSql = refs.map((ref) => ({ configName: ref.configName, version: ref.version === 'latest' ? null : ref.version }));
    // query to transform the input into a postgresql recordset so it can be joined with the data
    const inputCTE = sql`
      SELECT
        *
      FROM
        jsonb_to_recordset(${JSON.stringify(refsForSql)}) AS x ("configName" text, "version" int)
    `;

    // this query selects all the references requested by the input
    const baseQuery = this.drizzle
      .select({
        inputName: sql`input."configName" AS "inputConfigName"`,
        inputVersion: sql`input."version" AS "inputVersion"`,
        name: sql`${configs.configName} AS "configName"`,
        version: configs.version,
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
          or(eq(configs.version, sql`input."version"`), and(isNull(sql`input."version"`), eq(configs.isLatest, true)))
        )
      );

    // this query is the recursive query that will fetch the references of the requested references
    const recursiveQuery = recursiveQueryBuilder(this.drizzle, baseQuery, {
      inputName: sql`NULL`,
      inputVersion: sql`NULL`,
      name: configs.configName,
      version: configs.version,
      config: configs.config,
      isLatest: sql`
        CASE
          WHEN ${configsRefs.refVersion} IS NULL THEN TRUE
          ELSE FALSE
        END AS "isLatest"
      `,
    });

    const res = await this.drizzle.execute<
      { inputConfigName: string | null; inputVersion: number | null; configName: string | null; isLatest: boolean } & Pick<
        Config,
        'config' | 'version'
      >
    >(recursiveQuery);
    const returnValue: Awaited<ReturnType<typeof this.getAllConfigRefs>> = [];

    for (const row of res.rows) {
      if (row.configName === null) {
        throw new ConfigNotFoundError(
          `no matching config was found for the following reference: ${row.inputConfigName ?? ''} ${row.inputVersion ?? 'latest'}`
        );
      }
      returnValue.push({ config: row.config, configName: row.configName, version: row.version, isLatest: row.isLatest });
    }

    return returnValue;
  }

  /**
   * Creates a new configuration with the provided data.
   * @param config - The configuration data to be created.
   * @returns A Promise that resolves when the configuration is created.
   */
  public async createConfig(config: Omit<NewConfig, 'createdAt' | 'isLatest'> & { refs: ConfigReference[] }): Promise<void> {
    const { refs, ...configData } = config;
    const dbRefs = config.refs.map<NewConfigRef>((ref) => ({
      configName: config.configName,
      version: config.version,
      refConfigName: ref.configName,
      refVersion: ref.version === 'latest' ? null : ref.version,
    }));

    await this.drizzle.transaction(async (tx) => {
      await tx
        .insert(configs)
        .values({ ...configData, isLatest: true })
        .execute();

      if (dbRefs.length > 0) {
        await tx.insert(configsRefs).values(dbRefs).execute();
      }

      if (config.version !== 1) {
        await tx
          .update(configs)
          .set({ isLatest: false })
          .where(and(eq(configs.configName, config.configName), eq(configs.version, config.version - 1)))
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
  public async getConfig(name: string, version?: number): Promise<Config | undefined> {
    const comparators = [eq(configs.configName, name)];

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
  public async getConfigRecursive(name: string, version?: number): Promise<[Config, ConfigRefResponse[]] | undefined> {
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
      })
      .from(configs)
      .where(and(eq(configs.configName, name), versionOperator));

    // this query is the recursive query that will fetch the references of the config
    const recursiveQuery = recursiveQueryBuilder(this.drizzle, baseQuery, {
      configName: configs.configName,
      version: configs.version,
      config: configs.config,
      schemaId: sql`NULL`,
      createdAt: sql`NULL`,
      createdBy: sql`NULL`,
      isLatest: sql`
        CASE
          WHEN ${configsRefs.refVersion} IS NULL THEN TRUE
          ELSE FALSE
        END AS "isLatest"
      `,
    });

    const res = await this.drizzle.execute<Omit<Config, 'createdAt'> & { createdAt: string }>(recursiveQuery);

    const configResult = res.rows.shift();
    if (!configResult) {
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
    };
    const refs = res.rows.map((row) => ({ config: row.config, configName: row.configName, version: row.version, isLatest: row.isLatest }));

    return [config, refs];
  }

  /**
   * Retrieves configurations based on the provided search parameters and pagination options.
   * @param searchParams - The search parameters to filter the configurations.
   * @param paginationParams - The pagination options for the query (default: { limit: 1, offset: 0 }).
   * @returns A promise that resolves to an object containing the retrieved configurations and the total count.
   */
  public async getConfigs(
    searchParams: ConfigSearchParams,
    paginationParams: SqlPaginationParams = { limit: 1, offset: 0 }
  ): Promise<{ configs: Config[]; totalCount: number }> {
    const filterParams: SQLWrapper[] = this.getFilterParams(searchParams);

    const configsQuery = this.drizzle
      .select({
        configName: configs.configName,
        schemaId: configs.schemaId,
        version: configs.version,
        config: configs.config,
        createdAt: configs.createdAt,
        createdBy: configs.createdBy,
        isLatest: configs.isLatest,
        totalCount: sql<string>`count(*) OVER ()`,
      })
      .from(configs)
      .where(and(...filterParams))
      .offset(paginationParams.offset ?? DEFAULT_OFFSET)
      .limit(paginationParams.limit ?? DEFAULT_LIMIT);

    const configsResult = await configsQuery.execute();

    if (configsResult.length === 0) {
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
    }));

    return { configs: mappedConfig, totalCount };
  }

  private getFilterParams(searchParams: ConfigSearchParams): SQLWrapper[] {
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

    return filterParams;
  }
}
