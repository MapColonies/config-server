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
        expect(response.body.dependencies).toHaveProperty('parents');
        expect(response.body.dependencies).toHaveProperty('children');
        expect(Array.isArray(response.body.dependencies.parents)).toBe(true);
        expect(Array.isArray(response.body.dependencies.children)).toBe(true);

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

      it('should recursively get all children dependencies', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/boilerplate/v1' },
        });

        expectResponseStatus(response, 200);

        // Boilerplate schema references telemetry schemas (children)
        expect(response.body.dependencies.children.length).toBeGreaterThan(0);

        // Helper to collect all IDs from nested structure
        const collectIds = (nodes: typeof response.body.dependencies.children): string[] => {
          const ids: string[] = [];
          for (const node of nodes) {
            ids.push(node.id);
            if (node.children && node.children.length > 0) {
              ids.push(...collectIds(node.children));
            }
          }
          return ids;
        };

        const allChildIds = collectIds(response.body.dependencies.children);

        // Direct children should be at root level
        const rootChildIds = response.body.dependencies.children.map((c) => c.id);
        expect(rootChildIds).toContain('https://mapcolonies.com/common/telemetry/base/v1');
        expect(rootChildIds).toContain('https://mapcolonies.com/common/telemetry/tracing/v1');
        expect(rootChildIds).toContain('https://mapcolonies.com/common/telemetry/logger/v1');

        // Verify each child has id and name
        response.body.dependencies.children.forEach((child) => {
          expect(child).toHaveProperty('id');
          expect(child).toHaveProperty('name');
          expect(typeof child.id).toBe('string');
          expect(typeof child.name).toBe('string');
          expect(child.id).toMatch(/^https:\/\//);
        });

        // If any child has children, verify nested structure
        const childrenWithDescendants = response.body.dependencies.children.filter((c) => c.children && c.children.length > 0);
        if (childrenWithDescendants.length > 0) {
          childrenWithDescendants.forEach((child) => {
            expect(Array.isArray(child.children)).toBe(true);
            child.children?.forEach((grandchild) => {
              expect(grandchild).toHaveProperty('id');
              expect(grandchild).toHaveProperty('name');
            });
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
            ids.push(node.id);
            if (node.parents && node.parents.length > 0) {
              ids.push(...collectIds(node.parents));
            }
          }
          return ids;
        };

        const allParentIds = collectIds(response.body.dependencies.parents);

        // Verify boilerplate is one of the parents
        expect(allParentIds).toContain('https://mapcolonies.com/common/boilerplate/v1');

        // Verify each parent has id and name
        response.body.dependencies.parents.forEach((parent) => {
          expect(parent).toHaveProperty('id');
          expect(parent).toHaveProperty('name');
          expect(typeof parent.id).toBe('string');
          expect(typeof parent.name).toBe('string');
          expect(parent.id).toMatch(/^https:\/\//);
        });
      });

      it('should return empty arrays for schemas with no parents or children', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/circuit-breaker/v1' },
        });

        expectResponseStatus(response, 200);

        // Circuit-breaker has no external dependencies (no children)
        expect(response.body.dependencies.children).toEqual([]);

        // Parents array exists (may or may not be empty)
        expect(Array.isArray(response.body.dependencies.parents)).toBe(true);
      });

      it('should return TypeScript type content when available', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/redis/v1' },
        });

        expectResponseStatus(response, 200);

        // TypeScript content should be a non-empty string
        expect(response.body.typeContent).toBeDefined();
        expect(typeof response.body.typeContent).toBe('string');
        expect(response.body.typeContent).not.toBe('');
      });

      it('should not include duplicates in parents or children arrays', async function () {
        const response = await requestSender.getFullSchema({
          queryParams: { id: 'https://mapcolonies.com/common/boilerplate/v1' },
        });

        expectResponseStatus(response, 200);

        // Helper to collect all IDs recursively
        const collectAllIds = (nodes: { id: string; name: string; children?: any[]; parents?: any[] }[], field: 'children' | 'parents'): string[] => {
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
