import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import { createRequestSender, ExpectResponseStatus, expectResponseStatusFactory, RequestSender } from '@map-colonies/openapi-helpers/requestSender';
import { jsLogger } from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';
import { SchemaReference } from '@src/schemas/models/types';

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
        expect(response.body).toMatchObject({ $id: 'https://mapcolonies.com/common/boilerplate/v1' });
      });

      it('should return 200 status code and the dereferenced schema', async function () {
        const response = await requestSender.getSchema({
          queryParams: { id: 'https://mapcolonies.com/common/boilerplate/v1', shouldDereference: true },
        });
        expectResponseStatus(response, 200);

        expect(response).toSatisfyApiSpec();
        expect(response.body).toMatchObject({ $id: 'https://mapcolonies.com/common/boilerplate/v1' });
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

        // toSatisfyApiSpec already validates the structure, just verify non-empty
        expect(response.body.schemas.length).toBeGreaterThan(0);
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

        // Verify critical fields only - toSatisfyApiSpec validates the rest
        expect(response.body).toMatchObject({
          id: 'https://mapcolonies.com/common/redis/v1',
          dependencies: {
            parents: expect.any(Array) as unknown[],
            children: expect.any(Array) as unknown[],
          },
          envVars: expect.arrayContaining([
            expect.objectContaining({
              envVariable: expect.any(String) as string,
              configPath: expect.any(String) as string,
            }),
          ]) as unknown[],
        });
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

      it('should recursively get all children dependencies', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/boilerplate/v1' },
        });

        expectResponseStatus(response, 200);

        // Boilerplate schema references telemetry schemas (children)
        expect(response.body.dependencies.children.length).toBeGreaterThan(0);

        // Direct children should be at root level
        const rootChildIds = response.body.dependencies.children.map((c: { id: string }) => c.id);
        expect(rootChildIds).toEqual(
          expect.arrayContaining([
            'https://mapcolonies.com/common/telemetry/base/v1',
            'https://mapcolonies.com/common/telemetry/tracing/v1',
            'https://mapcolonies.com/common/telemetry/logger/v1',
          ])
        );

        // Verify structure using toMatchObject with asymmetric matchers
        expect(response.body.dependencies.children).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: expect.stringMatching(/^https:\/\//) as string,
              name: expect.any(String) as string,
            }),
          ]) as unknown[]
        );

        // If any child has children, verify nested structure
        const childrenWithDescendants = response.body.dependencies.children.filter((c: { children?: unknown[] }) =>
          Boolean(c.children && c.children.length > 0)
        );
        if (childrenWithDescendants.length > 0) {
          expect(childrenWithDescendants[0]).toMatchObject({
            children: expect.arrayContaining([
              expect.objectContaining({
                id: expect.any(String) as string,
                name: expect.any(String) as string,
              }),
            ]) as unknown[],
          });
        }
      });

      it('should recursively get all parent dependencies', async function () {
        // Telemetry base is referenced by many schemas (parents)
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/telemetry/base/v1' },
        });

        expectResponseStatus(response, 200);

        // Should have parents (schemas that reference it)
        expect(response.body.dependencies.parents.length).toBeGreaterThan(0);

        // Helper to collect all IDs from nested structure
        const collectIds = (nodes: typeof response.body.dependencies.parents): string[] => {
          const ids: string[] = [];
          for (const node of nodes) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            ids.push(node.id as string);
            if (node.parents && node.parents.length > 0) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
              ids.push(...collectIds(node.parents as typeof response.body.dependencies.parents));
            }
          }
          return ids;
        };

        const allParentIds = collectIds(response.body.dependencies.parents);

        // Verify boilerplate is one of the parents
        expect(allParentIds).toContain('https://mapcolonies.com/common/boilerplate/v1');

        // Verify each parent has correct structure using toMatchObject
        expect(response.body.dependencies.parents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: expect.stringMatching(/^https:\/\//) as string,
              name: expect.any(String) as string,
            }),
          ]) as unknown[]
        );
      });

      it('should return empty arrays for schemas with no parents or children', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/circuit-breaker/v1' },
        });

        expectResponseStatus(response, 200);

        // Circuit-breaker has no external dependencies (no children)
        expect(response.body.dependencies).toMatchObject({
          children: [],
          parents: expect.any(Array) as unknown[],
        });
      });

      it('should return TypeScript type content when available', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/redis/v1' },
        });

        expectResponseStatus(response, 200);

        // TypeScript content should be a non-empty string
        expect(response.body.typeContent).toBeDefined();
        expect(response.body.typeContent).toBeTypeOf('string');
        expect(response.body.typeContent).not.toBe('');
      });

      it('should not include duplicates in parents or children arrays', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/boilerplate/v1' },
        });

        expectResponseStatus(response, 200);

        // Helper to collect all IDs recursively
        const collectAllIds = (nodes: SchemaReference[], field: 'children' | 'parents'): string[] => {
          const ids: string[] = [];
          for (const node of nodes) {
            ids.push(node.id);
            if (node[field] && node[field].length > 0) {
              ids.push(...collectAllIds(node[field], field));
            }
          }
          return ids;
        };

        // Check for duplicates in children tree
        const allChildIds = collectAllIds(response.body.dependencies.children, 'children');
        const uniqueChildIds = [...new Set(allChildIds)];
        expect(allChildIds.length).toBe(uniqueChildIds.length);

        // Check for duplicates in parents tree
        const allParentIds = collectAllIds(response.body.dependencies.parents, 'parents');
        const uniqueParentIds = [...new Set(allParentIds)];
        expect(allParentIds.length).toBe(uniqueParentIds.length);
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
