import * as supertest from 'supertest';
import type { paths } from '../../../../src/openapiTypes';

export class ConfigRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async getConfigs(params: paths['/config']['get']['parameters']['query']): Promise<supertest.Test> {
    return supertest
      .agent(this.app)
      .get('/config')
      .query(params ?? {})
      .set('Content-Type', 'application/json');
  }

  public async getConfigByName(name: string, params: paths['/config/{name}']['get']['parameters']['query'] = {}): Promise<supertest.Test> {
    return supertest.agent(this.app).get(`/config/${name}`).query(params).set('Content-Type', 'application/json');
  }

  public async getConfigByVersion(
    name: string,
    version: number | 'latest',
    params: paths['/config/{name}/{version}']['get']['parameters']['query'] = {}
  ): Promise<supertest.Test> {
    return supertest.agent(this.app).get(`/config/${name}/${version}`).query(params).set('Content-Type', 'application/json');
  }

  public async postConfig(
    config: Omit<paths['/config']['post']['requestBody']['content']['application/json'], 'createdBy' | 'createdAt'>
  ): Promise<supertest.Test> {
    return supertest.agent(this.app).post('/config').send(config).set('Content-Type', 'application/json');
  }
}
