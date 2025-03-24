import { agent, type Response } from 'supertest';
import type { Express } from 'express';

export class DocsRequestSender {
  public constructor(private readonly app: Express) {}

  public async getDocs(): Promise<Response> {
    return agent(this.app).get('/docs/api/');
  }

  public async getDocsJson(): Promise<Response> {
    return agent(this.app).get('/docs/api.json');
  }
}
