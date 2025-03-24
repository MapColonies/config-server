import { type Express } from 'express';
import { agent, Test } from 'supertest';

export class SchemaRequestSender {
  public constructor(private readonly app: Express) {}

  public async getCapabilities(): Promise<Test> {
    return agent(this.app).get('/capabilities').set('Content-Type', 'application/json');
  }
}
