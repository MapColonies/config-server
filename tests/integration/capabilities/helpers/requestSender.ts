import * as supertest from 'supertest';

export class SchemaRequestSender {
  public constructor(private readonly app: Express.Application) {}

  public async getCapabilities(): Promise<supertest.Test> {
    return supertest.agent(this.app).get('/capabilities').set('Content-Type', 'application/json');
  }
}
