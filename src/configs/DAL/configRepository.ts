import { Logger, SQLWrapper, and, eq, gt, lt, max, sql } from 'drizzle-orm';
import { injectable, inject } from 'tsyringe';
import { PgSelect } from 'drizzle-orm/pg-core';
import { SERVICES } from '../../common/constants';
import { Drizzle } from '../../db/createConnection';
import { Config, NewConfig, configs } from '../models/config';

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
}

export interface SqlPaginationParams {
  limit?: number;
  offset?: number;
}

@injectable()
export class ConfigRepository {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(SERVICES.DRIZZLE) private readonly drizzle: Drizzle) {}

  public async getConfigMaxVersion(name: string): Promise<number | null> {
    const res = await this.drizzle
      .select({ maxVersion: max(configs.version) })
      .from(configs)
      .where(eq(configs.configName, name))
      .execute();

    return res[0].maxVersion ?? null;
  }

  public async createConfig(config: Omit<NewConfig, 'createdAt'>): Promise<void> {
    await this.drizzle.insert(configs).values(config).execute();
  }

  public async getConfig(name: string, version?: number): Promise<Config | undefined> {
    const maxVersion = this.drizzle.$with('maxVersion').as(
      this.drizzle
        .select({ maxVersion: max(configs.version) })
        .from(configs)
        .where(eq(configs.configName, name))
    );

    const versionCompare = version !== undefined ? version : sql<number>`(select * from ${maxVersion})`;

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
        totalCount: sql<number>`count(*) over()`,
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

    const totalCount = configsResult[0].totalCount;

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

    if (typeof searchParams.version === 'number') {
      filterParams.push(eq(configs.version, searchParams.version));
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
