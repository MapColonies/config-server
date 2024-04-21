import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { Drizzle } from '../../db/createConnection';
import { SERVICES } from '../../common/constants';
import { paths } from '../../schema';
import { Config, configs } from './config';
import { and, eq } from 'drizzle-orm';

@injectable()
export class ConfigManager {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SERVICES.DRIZZLE) private readonly drizzle: Drizzle
  ) {}

  public async getConfig(name: string, version?: string): Promise<Config> {
    const config = await this.drizzle.query.configs.findFirst({where: and(eq(configs.configName, name), version ? eq(configs.version, version): undefined)} );

    if (!config) {
      throw new Error('Config not found');
    }
    return config;
  }

  public async getConfigs(
    options?: paths['/config']['get']['parameters']['query']
  ): Promise<Config[]> {
    const configsResult = await this.drizzle.select().from(configs).
    return {
      configs: configsResult
    };
  }
}
