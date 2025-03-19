import { type Express } from 'express';
import supertest from 'supertest';

export class SchemaRequestSender {
  public constructor(private readonly app: Express) {}

  public async getCapabilities(): Promise<supertest.Test> {
    return supertest.agent(this.app).get('/capabilities').set('Content-Type', 'application/json');
  }
}
