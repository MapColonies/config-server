import { agent, type Test } from 'supertest';
import type { Express } from 'express';
import { paths } from '@openapi';

export class SchemaRequestSender {
  public constructor(private readonly app: Express) {}

  public async getSchemas(): Promise<Test> {
    return agent(this.app).get('/schema/tree').set('Content-Type', 'application/json');
  }

  public async getSchema(queryParams: paths['/schema']['get']['parameters']['query']): Promise<Test> {
    return agent(this.app).get(`/schema`).query(queryParams).set('Content-Type', 'application/json');
  }
}
