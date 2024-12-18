import * as supertest from 'supertest';
import { paths } from '@openapi';

export class SchemaRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async getSchemas(): Promise<supertest.Test> {
    return supertest.agent(this.app).get('/schema/tree').set('Content-Type', 'application/json');
  }

  public async getSchema(queryParams: paths['/schema']['get']['parameters']['query']): Promise<supertest.Test> {
    return supertest.agent(this.app).get(`/schema`).query(queryParams).set('Content-Type', 'application/json');
  }
}
