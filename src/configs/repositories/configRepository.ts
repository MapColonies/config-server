import { Logger, SQL, SQLWrapper, and, eq, gt, lt, max, sql } from 'drizzle-orm';
import { inject, scoped, Lifecycle } from 'tsyringe';
import { PgDialect, PgSelect, alias } from 'drizzle-orm/pg-core';
import { SERVICES } from '../../common/constants';
import { Drizzle } from '../../db/createConnection';
import { Config, NewConfig, NewConfigRef, configs, configsRefs } from '../models/config';
import { ConfigReference } from '../models/configReference';

const DEFAULT_LIMIT = 10;
const DEFAULT_OFFSET = 0;

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

@scoped(Lifecycle.ContainerScoped)
export class ConfigRepository {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.DRIZZLE) private readonly drizzle: Drizzle
  ) {}

  public async getAllConfigRefs(refs: ConfigReference[]): Promise<(Pick<Config, 'config' | 'configName' | 'version'> & { isMaxVersion: boolean })[]> {
    const refsForSql = refs.map((ref) => ({ configName: ref.configName, version: ref.version === 'latest' ? null : ref.version }));
    // query to transform the input into a postgresql recordset so it can be joined with the data
    const inputCTE = sql`
      SELECT
        *
      FROM
        jsonb_to_recordset(${JSON.stringify(refsForSql)}) AS x ("configName" text, "version" int)
    `;

    // query factory to get the max version of a config
    const maxVersionQueryFactory = (comparator: SQLWrapper): SQLWrapper =>
      this.drizzle
        .select({ maxVersion: max(configs.version) })
        .from(configs)
        .where(eq(configs.configName, comparator));

    const baseQuery = this.drizzle
      .select({
        /* eslint-disable @typescript-eslint/naming-convention */
        inputName: sql`input."configName" AS "inputConfigName"`,
        inputVersion: sql`input."version" AS "inputVersion"`,
        name: sql`${configs.configName} AS "configName"`,
        version: configs.version,
        config: configs.config,
        isMaxVersion: sql`
          CASE
            WHEN input."version" IS NULL THEN TRUE
            ELSE FALSE
          END AS "isMaxVersion"
        `,
        /* eslint-enable @typescript-eslint/naming-convention */
      })
      .from(sql`INPUT`)
      .leftJoin(
        configs,
        and(
          eq(configs.configName, sql`input."configName"`),
          eq(
            configs.version,
            sql`
              coalesce(
                input."version",
                (${maxVersionQueryFactory(configs.configName)})
              )
            `
          )
        )
      );

    const recursiveQuery = this.drizzle
      .select({
        inputName: sql`NULL`,
        inputVersion: sql`NULL`,
        name: configs.configName,
        version: configs.version,
        config: configs.config,
        isMaxVersion: sql`
          CASE
            WHEN ${configsRefs.refVersion} IS NULL THEN TRUE
            ELSE FALSE
          END AS "isMaxVersion"
        `,
      })
      .from(sql`rec`)
      .innerJoin(configsRefs, and(eq(configsRefs.configName, sql`rec."configName"`), eq(configsRefs.version, sql`rec."version"`)))
      .innerJoin(
        configs,
        and(
          eq(configsRefs.refConfigName, configs.configName),
          eq(
            configs.version,
            sql`
              coalesce(
                ${configsRefs.refVersion},
                (${maxVersionQueryFactory(configs.configName)})
              )
            `
          )
        )
      );

    const q = sql`
      WITH RECURSIVE
        INPUT AS (${inputCTE}),
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

    const res = await this.drizzle.execute<
      { inputConfigName: string | null; inputVersion: number | null; configName: string | null; isMaxVersion: boolean } & Pick<
        Config,
        'config' | 'version'
      >
    >(q);
    const returnValue: Awaited<ReturnType<typeof this.getAllConfigRefs>> = [];

    for (const row of res.rows) {
      if (row.configName === null) {
        throw new Error(`no matching config was found for the following reference: ${row.inputConfigName ?? ''} ${row.inputVersion ?? 'latest'}`);
      }
      returnValue.push({ config: row.config, configName: row.configName, version: row.version, isMaxVersion: row.isMaxVersion });
    }

    return returnValue;
  }

  public async getConfigMaxVersion(name: string): Promise<number | null> {
    const res = await this.drizzle
      .select({ maxVersion: max(configs.version) })
      .from(configs)
      .where(eq(configs.configName, name))
      .execute();

    return res[0].maxVersion ?? null;
  }

  public async createConfig(config: Omit<NewConfig, 'createdAt'> & { refs: ConfigReference[] }): Promise<void> {
    const { refs, ...configData } = config;
    const dbRefs = config.refs.map<NewConfigRef>((ref) => ({
      configName: config.configName,
      version: config.version,
      refConfigName: ref.configName,
      refVersion: ref.version === 'latest' ? null : ref.version,
    }));


    await this.drizzle.transaction(async (tx) => {
      await tx.insert(configs).values(configData).execute();
      if (dbRefs.length > 0) {
        await tx.insert(configsRefs).values(dbRefs).execute();
      }
    });
  }

  public async getConfig(name: string, version?: number): Promise<Config | undefined> {
    const maxVersion = this.drizzle.$with('maxVersion').as(
      this.drizzle
        .select({ maxVersion: max(configs.version) })
        .from(configs)
        .where(eq(configs.configName, name))
    );

    const versionCompare =
      version !== undefined
        ? version
        : sql<number>`
            (
              SELECT
                *
              FROM
                ${maxVersion}
            )
          `;

    const config = await this.drizzle
      .with(maxVersion)
      .select()
      .from(configs)
      .where(and(eq(configs.configName, name), eq(configs.version, versionCompare)))
      .execute();

    if (config.length === 0) {
      return undefined;
    }
    return config[0];
  }

  public async getConfigs(
    searchParams: ConfigSearchParams,
    paginationParams: SqlPaginationParams = { limit: 1, offset: 0 }
  ): Promise<{ configs: Config[]; totalCount: number }> {
    const filterParams: SQLWrapper[] = this.getFilterParams(searchParams);

    let configsQuery = this.drizzle
      .select({
        configName: configs.configName,
        schemaId: configs.schemaId,
        version: configs.version,
        config: configs.config,
        createdAt: configs.createdAt,
        createdBy: configs.createdBy,
        totalCount: sql<string>`count(*) OVER ()`,
      })
      .from(configs)
      .where(and(...filterParams))
      .offset(paginationParams.offset ?? DEFAULT_OFFSET)
      .limit(paginationParams.limit ?? DEFAULT_LIMIT)
      .$dynamic();

    if (searchParams.version === 'latest') {
      configsQuery = this.withMaxVersions(configsQuery);
    }

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
    return filterParams;
  }

  // only used for drizzle so it infers the type
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private withMaxVersions<T extends PgSelect>(qb: T) {
    const maxVersions = this.drizzle
      .select({ configName: configs.configName, maxVersion: max(configs.version).as('maxVersion') })
      .from(configs)
      .groupBy(configs.configName)
      .as('maxVersions');

    const joinCondition = and(eq(configs.configName, maxVersions.configName), eq(configs.version, maxVersions.maxVersion));

    return qb.innerJoin(maxVersions, joinCondition);
  }
}
