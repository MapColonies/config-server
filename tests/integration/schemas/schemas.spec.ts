import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import { createRequestSender, ExpectResponseStatus, expectResponseStatusFactory, RequestSender } from '@map-colonies/openapi-helpers/requestSender';
import { jsLogger } from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';

const expectResponseStatus: ExpectResponseStatus = expectResponseStatusFactory(expect);

describe('schema', function () {
  let requestSender: RequestSender<paths, operations>;
  let dependencyContainer: DependencyContainer;
  beforeEach(async function () {
    const [app, container] = await getApp({
      override: [{ token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } }],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
    dependencyContainer = container;
  });

  afterEach(async function () {
    const onSignal = dependencyContainer.resolve<() => Promise<void>>('onSignal');
    await onSignal();
  });

  describe('/schema/tree', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the schemas tree', async function () {
        const response = await requestSender.getSchemasTree();

        expect(response.status).toBe(httpStatusCodes.OK);

        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('/schema/{path}', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the schema', async function () {
        const response = await requestSender.getSchema({ queryParams: { id: 'https://mapcolonies.com/common/boilerplate/v1' } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body).toHaveProperty('$id', 'https://mapcolonies.com/common/boilerplate/v1');
      });

      it('should return 200 status code and the dereferenced schema', async function () {
        const response = await requestSender.getSchema({
          queryParams: { id: 'https://mapcolonies.com/common/boilerplate/v1', shouldDereference: true },
        });
        expectResponseStatus(response, 200);

        expect(response).toSatisfyApiSpec();
        expect(response.body).toHaveProperty('$id', 'https://mapcolonies.com/common/boilerplate/v1');
      });
    });

    describe('Bad Path', function () {
      it('should return 400 status code if the path is invalid', async function () {
        const response = await requestSender.getSchema({ queryParams: { id: 'https://mapcolonies.com/../avi/..' } });
        expectResponseStatus(response, 400);
      });

      it('should return 404 status code if the schema is not found', async function () {
        const response = await requestSender.getSchema({ queryParams: { id: 'https://mapcolonies.com/avi' } });
        expectResponseStatus(response, 404);
      });
    });
  });

  describe('/schemas/index', function () {
    describe('Happy Path', function () {
      it('should return 200 status code with schemas index', async function () {
        const response = await requestSender.getSchemasIndex();

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // Verify structure
        expect(response.body).toHaveProperty('schemas');
        expect(Array.isArray(response.body.schemas)).toBe(true);

        // Verify schemas array has proper structure
        if (response.body.schemas.length > 0) {
          const firstSchema = response.body.schemas[0];
          expect(firstSchema).toHaveProperty('id');
          expect(firstSchema).toHaveProperty('name');
          expect(firstSchema).toHaveProperty('path');
          expect(firstSchema).toHaveProperty('version');
          expect(firstSchema).toHaveProperty('category');
        }

        // Verify cache headers are set
        expect(response.headers).toHaveProperty('cache-control');
      });
    });
  });

  describe('/schema/full', function () {
    describe('Happy Path', function () {
      it('should return 200 status code with full schema metadata', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/redis/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // Verify all required fields
        expect(response.body).toHaveProperty('id', 'https://mapcolonies.com/common/redis/v1');
        expect(response.body).toHaveProperty('name');
        expect(response.body).toHaveProperty('path');
        expect(response.body).toHaveProperty('version');
        expect(response.body).toHaveProperty('category');
        expect(response.body).toHaveProperty('rawContent');
        expect(response.body).toHaveProperty('dereferencedContent');
        expect(response.body).toHaveProperty('dependencies');
        expect(response.body).toHaveProperty('envVars');

        // Verify dependencies structure
        expect(response.body.dependencies).toHaveProperty('internal');
        expect(response.body.dependencies).toHaveProperty('external');
        expect(Array.isArray(response.body.dependencies.internal)).toBe(true);
        expect(Array.isArray(response.body.dependencies.external)).toBe(true);

        // Verify envVars structure
        expect(Array.isArray(response.body.envVars)).toBe(true);
        if (response.body.envVars.length > 0) {
          const firstEnvVar = response.body.envVars[0];
          expect(firstEnvVar).toHaveProperty('envVariable');
          expect(firstEnvVar).toHaveProperty('configPath');
        }

        // Verify TypeScript types (may be null)
        expect(response.body).toHaveProperty('typeContent');
      });

      it('should extract environment variables from schema with x-env-value', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/redis/v1' },
        });

        expectResponseStatus(response, 200);

        // Redis schema should have env vars like REDIS_HOST, REDIS_PORT, etc.
        expect(response.body.envVars.length).toBeGreaterThan(0);

        const envVarNames = response.body.envVars.map((v) => v.envVariable);
        expect(envVarNames).toContain('REDIS_HOST');
        expect(envVarNames).toContain('REDIS_PORT');
      });

      it('should extract internal dependencies', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/redis/v1' },
        });

        expectResponseStatus(response, 200);

        // Redis schema has #/definitions/tls reference
        expect(response.body.dependencies.internal.length).toBeGreaterThan(0);
        expect(response.body.dependencies.internal).toContain('#/definitions/tls');
      });
    });

    describe('Bad Path', function () {
      it('should return 400 status code if the path is invalid', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/../invalid/..' },
        });
        expectResponseStatus(response, 400);
      });

      it('should return 404 status code if the schema is not found', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/nonexistent/schema/v1' },
        });
        expectResponseStatus(response, 404);
      });
    });
  });
});
