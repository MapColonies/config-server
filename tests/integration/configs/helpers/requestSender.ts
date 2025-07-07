import { agent, type Test } from 'supertest';
import type { Express } from 'express';
import type { paths } from '@openapi';

export class ConfigRequestSender {
  public constructor(private readonly app: Express) {}

  public async getConfigs(params: paths['/config']['get']['parameters']['query']): Promise<Test> {
    return agent(this.app)
      .get('/config')
      .query(params ?? {})
      .set('Content-Type', 'application/json');
  }

  public async getConfigByVersion(
    name: string,
    version: number | 'latest',
    params: paths['/config/{name}/{version}']['get']['parameters']['query']
  ): Promise<Test> {
    return agent(this.app).get(`/config/${name}/${version}`).query(params).set('Content-Type', 'application/json');
  }

  public async postConfig(
    config: Omit<paths['/config']['post']['requestBody']['content']['application/json'], 'createdBy' | 'createdAt'>
  ): Promise<Test> {
    return agent(this.app).post('/config').send(config).set('Content-Type', 'application/json');
  }
}
