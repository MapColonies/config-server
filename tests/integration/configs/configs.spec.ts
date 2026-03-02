/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import 'jest-extended';
import 'jest-openapi';
import 'jest-sorted';

import fs from 'node:fs';
import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import { Logger, jsLogger } from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { faker } from '@faker-js/faker';
import { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import { createRequestSender, RequestSender, expectResponseStatusFactory, ExpectResponseStatus } from '@map-colonies/openapi-helpers/requestSender';
import { paths, operations } from '@openapi';
import { ConfigRepository } from '@src/configs/repositories/configRepository';
import { SchemaManager } from '@src/schemas/models/schemaManager';
import { Drizzle } from '@src/db/createConnection';
import { getApp } from '@src/app';
import { ConfigManager } from '@src/configs/models/configManager';
import { SERVICES } from '@common/constants';
import { Config, configs, configsRefs } from '@src/configs/models/config';
import * as utils from '@common/utils';
import { SchemaNotFoundError } from '@src/schemas/models/errors';
import {
  configsMockData,
  refs,
  schemaWithRef,
  schemaWithNestedRef,
  simpleSchema,
  primitiveRefSchema,
  primitiveSchema,
  simpleSchemaV2,
} from './helpers/data';

const expectResponseStatus: ExpectResponseStatus = expectResponseStatusFactory(expect);

vi.mock('../../../src/common/utils', async () => {
  const original = await vi.importActual('../../../src/common/utils');
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __esModule: true,
    ...original,
  };
});

async function getSchemaMock(id: string): Promise<JSONSchema> {
  switch (id) {
    case schemaWithRef.$id:
      return Promise.resolve(schemaWithRef);
    case schemaWithNestedRef.$id:
      return Promise.resolve(schemaWithNestedRef);
    case simpleSchema.$id:
      return Promise.resolve(simpleSchema);
    case simpleSchemaV2.$id:
      return Promise.resolve(simpleSchemaV2);
    case primitiveSchema.$id:
      return Promise.resolve(primitiveSchema);
    case primitiveRefSchema.$id:
      return Promise.resolve(primitiveRefSchema);
    default:
      throw new SchemaNotFoundError('Schema not found');
  }
}

describe('config', function () {
  let requestSender: RequestSender<paths, operations>;
  let dependencyContainer: DependencyContainer;
  beforeAll(async function () {
    const [app, container] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        {
          token: SchemaManager,
          provider: {
            useFactory: (container) => {
              const logger = container.resolve<Logger>(SERVICES.LOGGER);
              const manager = new SchemaManager(logger);
              // vi.spyOn(manager, 'getSchema').mockImplementation(getSchemaMock);
              manager.getSchema = getSchemaMock;
              return manager;
            },
          },
        },
      ],
      useChild: true,
    });
    requestSender = await createRequestSender<paths, operations>('openapi3.yaml', app);
    dependencyContainer = container;
    const drizzle = dependencyContainer.resolve<Drizzle>(SERVICES.DRIZZLE);
    await drizzle.insert(configs).values(configsMockData);
    await drizzle.insert(configsRefs).values(refs);
  });

  afterAll(async function () {
    const onSignal = dependencyContainer.resolve<() => Promise<void>>('onSignal');
    await onSignal();
  });

  describe('insertDefaultConfigs', function () {
    it('should insert a config without errors', async function () {
      vi.spyOn(utils, 'filesTreeGenerator').mockImplementationOnce(async function* () {
        await Promise.resolve();
        yield {
          name: 'v1.configs.json',
          parentPath: 'schemas/build/schemas/simpleSchema',
        } as fs.Dirent;
      });

      const fsSpy = vi.spyOn(fs, 'readFileSync');

      const configManager = dependencyContainer.resolve(ConfigManager);

      fsSpy.mockReturnValueOnce(JSON.stringify([{ name: 'default-simple-config', value: { name: 'name1', age: 1 } }]));

      await configManager.insertDefaultConfigs();

      const defaultConfig = await configManager.getConfig('default-simple-config', 'https://mapcolonies.com/simpleSchema/v1', 1);
      expect(defaultConfig).toHaveProperty('config', { name: 'name1', age: 1 });
    });

    it('should not insert config if it already exists', async function () {
      vi.spyOn(utils, 'filesTreeGenerator').mockImplementationOnce(async function* () {
        await Promise.resolve();
        yield {
          name: 'v1.configs.json',
          parentPath: 'schemas/build/schemas/simpleSchema',
        } as fs.Dirent;
      });

      const fsSpy = vi.spyOn(fs, 'readFileSync');

      const configManager = dependencyContainer.resolve(ConfigManager);
      await configManager.createConfig({
        config: { name: 'name1', age: 1 },
        configName: 'already-exists',
        schemaId: 'https://mapcolonies.com/simpleSchema/v1',
        version: 1,
      });

      fsSpy.mockReturnValueOnce(JSON.stringify([{ name: 'already-exists', value: { name: 'name1', age: 1 } }]));

      await configManager.insertDefaultConfigs();

      const defaultConfig = await configManager.getConfig('default-simple-config', 'https://mapcolonies.com/simpleSchema/v1');
      expect(defaultConfig).toHaveProperty('config', { name: 'name1', age: 1 });
      expect(defaultConfig).toHaveProperty('version', 1);
    });

    it('should throw an error if there is a ref for a config that does not exists', async function () {
      vi.spyOn(utils, 'filesTreeGenerator').mockImplementationOnce(async function* () {
        await Promise.resolve();
        yield {
          name: 'v1.configs.json',
          parentPath: 'schemas/build/schemas/simpleSchema',
        } as fs.Dirent;
      });

      const fsSpy = vi.spyOn(fs, 'readFileSync');

      const configManager = dependencyContainer.resolve(ConfigManager);

      fsSpy.mockReturnValueOnce(JSON.stringify([{ name: 'bad-ref', value: { $ref: { configName: 'avi', version: 'latest' } } }]));

      const action = configManager.insertDefaultConfigs();

      await expect(action).rejects.toThrow();
    });
  });

  describe('updateOldConfigs', function () {
    it('should complete successfully when no old configs exist', async function () {
      const configManager = dependencyContainer.resolve(ConfigManager);

      const action = configManager.updateOldConfigs();

      await expect(action).toResolve();
    });

    it('should update old configs with v1 schema version to v2', async function () {
      const drizzle = dependencyContainer.resolve<Drizzle>(SERVICES.DRIZZLE);
      const configManager = dependencyContainer.resolve(ConfigManager);

      // Insert a config with v1 schema version to simulate old config
      const oldConfigWithV1Schema = {
        configName: 'old-config-v1',
        schemaId: 'https://mapcolonies.com/simpleSchema/v1',
        version: 1,
        config: { name: 'old name', age: 50 },
        createdBy: 'system',
        isLatest: true,
        configSchemaVersion: 'v1',
        hash: 'temp-hash-old-v1',
      };

      await drizzle.insert(configs).values(oldConfigWithV1Schema);

      await configManager.updateOldConfigs();

      // Verify the config was updated to v2 schema version
      const updatedConfig = await configManager.getConfig('old-config-v1', 'https://mapcolonies.com/simpleSchema/v1');
      expect(updatedConfig).toHaveProperty('configSchemaVersion', 'v2');
      expect(updatedConfig).toHaveProperty('config', { name: 'old name', age: 50 });
    });

    it('should update configs with v1 format refs to include schemaId', async function () {
      const drizzle = dependencyContainer.resolve<Drizzle>(SERVICES.DRIZZLE);
      const configManager = dependencyContainer.resolve(ConfigManager);

      // First create a config that will be referenced
      const referencedConfig = {
        configName: 'referenced-config',
        schemaId: 'https://mapcolonies.com/simpleSchema/v1',
        version: 1,
        config: { name: 'referenced', age: 30 },
        createdBy: 'system',
        isLatest: true,
        configSchemaVersion: 'v1',
        hash: 'temp-hash-ref',
      };

      await drizzle.insert(configs).values(referencedConfig);

      // Create a config with v1 format ref (missing schemaId)
      const configWithV1Ref = {
        configName: 'config-with-v1-ref',
        schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
        version: 1,
        config: {
          manager: {
            $ref: {
              configName: 'referenced-config',
              version: 1,
              // Note: missing schemaId - this is v1 format
            },
          },
          role: 'manager',
        },
        createdBy: 'system',
        isLatest: true,
        configSchemaVersion: 'v1',
        hash: 'temp-hash-withref',
      };

      await drizzle.insert(configs).values(configWithV1Ref);

      await configManager.updateOldConfigs();

      // Verify the config was updated with v2 format refs including schemaId
      const updatedConfig = await configManager.getConfig('config-with-v1-ref', 'https://mapcolonies.com/schemaWithRef/v1');
      expect(updatedConfig).toHaveProperty('configSchemaVersion', 'v2');

      const configData = updatedConfig.config;
      const manager = configData.manager as Record<string, unknown>;
      const managerRef = manager.$ref as Record<string, unknown>;
      expect(managerRef).toHaveProperty('configName', 'referenced-config');
      expect(managerRef).toHaveProperty('version', 1);
      expect(managerRef).toHaveProperty('schemaId', 'https://mapcolonies.com/simpleSchema/v1');
    });

    it('should handle configs with latest version refs during update', async function () {
      const drizzle = dependencyContainer.resolve<Drizzle>(SERVICES.DRIZZLE);
      const configManager = dependencyContainer.resolve(ConfigManager);

      // Create a config that will be referenced
      const referencedConfig = {
        configName: 'latest-ref-target',
        schemaId: 'https://mapcolonies.com/simpleSchema/v1',
        version: 1,
        config: { name: 'target', age: 25 },
        createdBy: 'system',
        isLatest: true,
        configSchemaVersion: 'v1',
        hash: 'temp-hash-latest-target',
      };

      await drizzle.insert(configs).values(referencedConfig);

      // Create a config with v1 format ref using 'latest' version
      const configWithLatestRef = {
        configName: 'config-with-latest-ref',
        schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
        version: 1,
        config: {
          manager: {
            $ref: {
              configName: 'latest-ref-target',
              version: 'latest',
              // Note: missing schemaId - this is v1 format
            },
          },
          role: 'manager',
        },
        createdBy: 'system',
        isLatest: true,
        configSchemaVersion: 'v1',
        hash: 'temp-hash-latest-ref',
      };

      await drizzle.insert(configs).values(configWithLatestRef);

      await configManager.updateOldConfigs();

      // Verify the config was updated with v2 format refs including schemaId
      const updatedConfig = await configManager.getConfig('config-with-latest-ref', 'https://mapcolonies.com/schemaWithRef/v1');
      expect(updatedConfig).toHaveProperty('configSchemaVersion', 'v2');

      const configData = updatedConfig.config;
      const manager = configData.manager as Record<string, unknown>;
      const managerRef = manager.$ref as Record<string, unknown>;
      expect(managerRef).toHaveProperty('configName', 'latest-ref-target');
      expect(managerRef).toHaveProperty('version', 'latest');
      expect(managerRef).toHaveProperty('schemaId', 'https://mapcolonies.com/simpleSchema/v1');
    });

    it('should continue processing other configs when one config update fails', async function () {
      const drizzle = dependencyContainer.resolve<Drizzle>(SERVICES.DRIZZLE);
      const configManager = dependencyContainer.resolve(ConfigManager);
      const configRepository = dependencyContainer.resolve(ConfigRepository);

      // Insert multiple configs with v1 schema version
      const oldConfigs = [
        {
          configName: 'config-will-fail',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: { name: 'failing', age: 40 },
          createdBy: 'system',
          isLatest: true,
          configSchemaVersion: 'v1',
          hash: 'temp-hash-fail',
        },
        {
          configName: 'config-will-succeed',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: { name: 'succeeding', age: 45 },
          createdBy: 'system',
          isLatest: true,
          configSchemaVersion: 'v1',
          hash: 'temp-hash-succeed',
        },
      ];

      await drizzle.insert(configs).values(oldConfigs);

      // Mock updateConfigToNewSchemaVersion to fail for first config
      const originalUpdate = configRepository.updateConfigToNewSchemaVersion.bind(configRepository);
      vi.spyOn(configRepository, 'updateConfigToNewSchemaVersion').mockImplementation(async (input) => {
        if (input.configName === 'config-will-fail') {
          throw new Error('Simulated database error');
        }
        // For subsequent calls, just resolve successfully since we're testing error handling
        return originalUpdate(input);
      });

      // Should not throw even if one config fails
      await expect(configManager.updateOldConfigs()).toResolve();

      // Verify that the second config was still updated
      const successfulConfig = await configManager.getConfig('config-will-succeed', 'https://mapcolonies.com/simpleSchema/v1');
      expect(successfulConfig).toHaveProperty('configSchemaVersion', 'v2');
    });
  });

  describe('GET /config', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the configs', async function () {
        const response = await requestSender.getConfigs({});

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).not.toHaveLength(0);
      });

      it('should return 200 status code and the configs with pagination', async function () {
        const response = await requestSender.getConfigs({ queryParams: { limit: 1, offset: 1 } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).toHaveLength(1);
        expect(response.body).toHaveProperty('total');
      });

      it('should return 200 status code and filter the configs', async function () {
        /* eslint-disable @typescript-eslint/naming-convention */
        const response = await requestSender.getConfigs({
          queryParams: {
            config_name: 'config2',
            version: 1,
            schema_id: 'https://mapcolonies.com/simpleSchema/v1',
            created_by: 'user3',
            created_at_gt: '2000-01-01T00:00:00Z',
            created_at_lt: '2002-01-02T00:00:00Z',
          },
        });
        /* eslint-enable @typescript-eslint/naming-convention */

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).toHaveLength(1);
      });

      it('should return 200 status code when using full text search', async function () {
        const response = await requestSender.getConfigs({ queryParams: { q: 'config2' } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).toHaveLength(1);
      });

      it('should return 200 and the latest version of the config', async function () {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await requestSender.getConfigs({ queryParams: { version: 'latest', config_name: 'config1' } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).not.toHaveLength(0);
        expect(response.body.configs?.[0]).toHaveProperty('version', 2);
      });

      it('should return 200 status code and empty array if no results have returned', async function () {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await requestSender.getConfigs({ queryParams: { config_name: 'not-exists' } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).toHaveLength(0);
        expect(response.body).toHaveProperty('total', 0);
      });

      it('should return 200 and filter the configs by version', async function () {
        const response = await requestSender.getConfigs({ queryParams: { version: 1 } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).not.toHaveLength(0);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).toSatisfyAll((config) => config.version === 1);
      });

      it('should return 200 and sort the configs by config name', async function () {
        const response = await requestSender.getConfigs({ queryParams: { sort: ['config-name:asc'] } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).toBeSortedBy('configName', { descending: false });
      });

      it('should return 200 and sort the configs by name and version', async function () {
        const response = await requestSender.getConfigs({ queryParams: { sort: ['config-name:asc', 'version:desc'] } });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.configs).toBeSorted({
          descending: false,
          compare: (a: Config, b: Config) => {
            const nameCompare = a.configName.localeCompare(b.configName);
            if (nameCompare !== 0) {
              return nameCompare;
            }
            return b.version - a.version;
          },
        });
      });
    });

    describe('Bad Path', function () {
      it('should return 400 status code when using invalid date format', async function () {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await requestSender.getConfigs({ queryParams: { created_at_gt: 'invalid' } });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid version', async function () {
        const response = await requestSender.getConfigs({ queryParams: { version: 'invalid' as unknown as number } });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid limit', async function () {
        const response = await requestSender.getConfigs({ queryParams: { limit: 'invalid' as unknown as number } });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if a bad sort query option is provided', async function () {
        const response = await requestSender.getConfigs({ queryParams: { sort: ['config-name:ascc'] } });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 422 status code when a sort option is repeated', async function () {
        const response = await requestSender.getConfigs({ queryParams: { sort: ['config-name:asc', 'config-name:desc'] } });

        expectResponseStatus(response, 422);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        vi.spyOn(configRepo, 'getConfigs').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.getConfigs({});

        expectResponseStatus(response, 500);
        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('GET /config/{name}/{version}', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the configs', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.version).toBe(1);
      });

      it('should return 200 status code and the latest config', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 'latest' },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.version).toBe(2);
      });

      it('should return 200 status code and the dereferenced config', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config-ref-2', version: 1 },
          queryParams: {
            shouldDereference: true,
            schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
          },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body.config).toStrictEqual({
          manager: {
            name: 'name4',
            age: 5,
          },
        });
      });

      it('should return 200 status code and the dereferenced config without any refs inside', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config-ref-3', version: 1 },
          queryParams: {
            shouldDereference: true,
            schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
          },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(JSON.stringify(response.body.config)).not.toContain('$ref');
      });
    });

    describe('Bad Path', function () {
      it('should return 404 status code when the config not exists', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 3 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 404);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid version', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 'invalid' as unknown as number },
          queryParams: {
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code if schemaId is not provided', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: {} as { schemaId: string },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        vi.spyOn(configRepo, 'getConfig').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 500);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('ETag and Caching', function () {
      it('should return ETag header in response', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.headers).toHaveProperty('etag');
        expect(response.headers.etag).toBe('hash-config1-v1');
      });

      it('should return 304 Not Modified when If-None-Match matches ETag', async function () {
        // First request to get the ETag
        const firstResponse = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(firstResponse, 200);
        const etag = firstResponse.headers.etag;
        expect(etag).toBeDefined();
        expect(etag).toBeTypeOf('string');

        // Second request with If-None-Match header
        const secondResponse = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
          headers: { 'If-None-Match': etag! },
        });

        expectResponseStatus(secondResponse, 304);
        // 304 responses should have no body content (empty object from HTTP client)
        expect(Object.keys(secondResponse.body).length).toBe(0);
      });

      it('should return 200 and full response when If-None-Match does not match', async function () {
        const response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
          headers: { 'If-None-Match': 'different-hash' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();
        expect(response.body).toBeDefined();
        expect(response.body.version).toBe(1);
      });

      it('should return different ETags for different config versions', async function () {
        const v1Response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        const v2Response = await requestSender.getVersionedConfig({
          pathParams: { name: 'config1', version: 2 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(v1Response, 200);
        expectResponseStatus(v2Response, 200);
        expect(v1Response.headers.etag).toBe('hash-config1-v1');
        expect(v2Response.headers.etag).toBe('hash-config1-v2');
        expect(v1Response.headers.etag).not.toBe(v2Response.headers.etag);
      });
    });
  });

  describe('POST /config', function () {
    describe('Happy Path', function () {
      it('should return 201 and create the config', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'new-config1',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 1,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 201);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create the config when a previous one already exists', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config1',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 2,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 201);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create the config with refs', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config-with-ref',
            schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
            version: 1,
            config: {
              manager: {
                $ref: {
                  configName: 'config3',
                  version: 'latest',
                  schemaId: 'https://mapcolonies.com/simpleSchema/v1',
                },
              },
              role: 'unknown',
            },
          },
        });

        expectResponseStatus(response, 201);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create the config with refs with primitives', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config-with-primitive-ref',
            schemaId: 'https://mapcolonies.com/primitiveRefSchema/v1',
            version: 1,
            config: {
              primitive: {
                $ref: {
                  configName: 'primitive-config',
                  version: 1,
                  schemaId: 'https://mapcolonies.com/primitiveSchema/v1',
                },
              },
            },
          },
        });

        expectResponseStatus(response, 201);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create a config that is a root ref to another config', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config-root-ref',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 1,
            config: {
              $ref: {
                configName: 'config1',
                version: 'latest',
                schemaId: 'https://mapcolonies.com/simpleSchema/v1',
              },
            },
          },
        });

        expectResponseStatus(response, 201);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create a config with the same name as an existing config from different schema version', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config1',
            schemaId: 'https://mapcolonies.com/simpleSchema/v2',
            version: 1,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 201);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Bad Path', function () {
      it('should return 400 status code when using invalid version', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'new-config2',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 'invalid' as unknown as number,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid schema id', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'new-config2',
            schemaId: 'invalid',
            version: 1,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid config', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'new-config2',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 1,
            config: {
              name: faker.person.firstName(),
              age: 'invalid',
            },
          },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if a ref is does not exist in the database', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config-with-ref',
            schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
            version: 1,
            config: {
              manager: {
                $ref: {
                  configName: 'config3',
                  version: 99,
                },
              },
              role: 'unknown',
            },
          },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if a ref is not valid', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config-with-ref',
            schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
            version: 1,
            config: {
              manager: {
                $ref: {
                  configName: 'config3',
                  version: 'invalid',
                },
              },
              role: 'unknown',
            },
          },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if the schemaId of the config does not exist', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config-not-exists',
            schemaId: 'https://mapcolonies.com/not-exists/v1',
            version: 1,
            config: {
              manager: 'null',
              role: 'unknown',
            },
          },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 status code when trying to post a new version of a config that does not exists', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'not-exists',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 2,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 409);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 status code when trying to post a version that already exists', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config1',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 1,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 409);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 status code when the schema provided does not match the schema of the last config', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            schemaId: 'https://mapcolonies.com/primitiveSchema/v1',
            configName: 'config4',
            version: 3,
            config: { string: 'string' },
          },
        });

        expectResponseStatus(response, 409);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 if trying to create a config with the same name as an existing config from different schema', async function () {
        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'config1',
            schemaId: 'https://mapcolonies.com/primitiveSchema/v1',
            version: 1,
            config: 'primitive' as unknown as Record<string, unknown>,
          },
        });

        expectResponseStatus(response, 409);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        vi.spyOn(configRepo, 'createConfig').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.upsertConfig({
          requestBody: {
            configName: 'new-config3',
            schemaId: 'https://mapcolonies.com/simpleSchema/v1',
            version: 1,
            config: {
              name: faker.person.firstName(),
              age: faker.number.int(),
            },
          },
        });

        expectResponseStatus(response, 500);
        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('Hash Propagation', function () {
    it('should propagate hash changes to parent configs in-place when child is updated', async function () {
      // Create a child config first
      const childResponse = await requestSender.upsertConfig({
        requestBody: {
          configName: 'child-config-test',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: {
            name: 'child-v1',
            age: 10,
          },
        },
      });

      expectResponseStatus(childResponse, 201);

      // Create a parent config that references the child with 'latest'
      const parentResponse = await requestSender.upsertConfig({
        requestBody: {
          configName: 'parent-config-test',
          schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
          version: 1,
          config: {
            manager: {
              $ref: {
                configName: 'child-config-test',
                version: 'latest',
                schemaId: 'https://mapcolonies.com/simpleSchema/v1',
              },
            },
          },
        },
      });

      expectResponseStatus(parentResponse, 201);

      // Fetch parent v1 and save its ETag/hash
      const parentV1Before = await requestSender.getVersionedConfig({
        pathParams: { name: 'parent-config-test', version: 1 },
        queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
      });

      expectResponseStatus(parentV1Before, 200);
      const parentV1HashBefore = parentV1Before.headers.etag;
      expect(parentV1HashBefore).toBeDefined();

      // Update child to v2
      const childV2Response = await requestSender.upsertConfig({
        requestBody: {
          configName: 'child-config-test',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1, // ConfigManager will increment this
          config: {
            name: 'child-v2-updated',
            age: 20,
          },
        },
      });

      expectResponseStatus(childV2Response, 201);

      // Verify that parent v1's hash was updated IN-PLACE (no new version created)
      const parentV1After = await requestSender.getVersionedConfig({
        pathParams: { name: 'parent-config-test', version: 1 },
        queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
      });

      expectResponseStatus(parentV1After, 200);
      expect(parentV1After.body.version).toBe(1); // Still version 1, no new version created
      const parentV1HashAfter = parentV1After.headers.etag;
      expect(parentV1HashAfter).toBeDefined();
      expect(parentV1HashAfter).not.toBe(parentV1HashBefore); // Hash has changed in-place

      // Verify the parent config content is unchanged (only hash changed)
      expect(parentV1After.body.config).toStrictEqual(parentV1Before.body.config);

      // Verify that 'latest' still points to v1 (no new version was created)
      const parentLatest = await requestSender.getVersionedConfig({
        pathParams: { name: 'parent-config-test', version: 'latest' },
        queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
      });

      expectResponseStatus(parentLatest, 200);
      expect(parentLatest.body.version).toBe(1); // Latest is still v1
      expect(parentLatest.headers.etag).toBe(parentV1HashAfter); // Same hash as v1
    });

    it('should propagate hash changes through multiple levels (grandparent -> parent -> child)', async function () {
      // Create a child config
      const childResponse = await requestSender.upsertConfig({
        requestBody: {
          configName: 'multi-level-child',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: {
            name: 'child-v1',
            age: 10,
          },
        },
      });

      expectResponseStatus(childResponse, 201);

      // Create a parent config that references the child
      const parentResponse = await requestSender.upsertConfig({
        requestBody: {
          configName: 'multi-level-parent',
          schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
          version: 1,
          config: {
            manager: {
              $ref: {
                configName: 'multi-level-child',
                version: 'latest',
                schemaId: 'https://mapcolonies.com/simpleSchema/v1',
              },
            },
          },
        },
      });

      expectResponseStatus(parentResponse, 201);

      // Create a grandparent config that references the parent
      const grandparentResponse = await requestSender.upsertConfig({
        requestBody: {
          configName: 'multi-level-grandparent',
          schemaId: 'https://mapcolonies.com/schemaWithNestedRef/v1',
          version: 1,
          config: {
            manager: {
              $ref: {
                configName: 'multi-level-parent',
                version: 'latest',
                schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
              },
            },
          },
        },
      });

      expectResponseStatus(grandparentResponse, 201);

      // Fetch initial hashes for all configs
      const parentV1Before = await requestSender.getVersionedConfig({
        pathParams: { name: 'multi-level-parent', version: 1 },
        queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
      });
      expectResponseStatus(parentV1Before, 200);
      const parentHashBefore = parentV1Before.headers.etag;

      const grandparentV1Before = await requestSender.getVersionedConfig({
        pathParams: { name: 'multi-level-grandparent', version: 1 },
        queryParams: { schemaId: 'https://mapcolonies.com/schemaWithNestedRef/v1' },
      });
      expectResponseStatus(grandparentV1Before, 200);
      const grandparentHashBefore = grandparentV1Before.headers.etag;

      // Update the child config to v2
      const childV2Response = await requestSender.upsertConfig({
        requestBody: {
          configName: 'multi-level-child',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1, // Will be incremented to v2
          config: {
            name: 'child-v2-updated',
            age: 20,
          },
        },
      });

      expectResponseStatus(childV2Response, 201);

      // Verify parent hash updated in-place (version still 1, hash changed)
      const parentV1After = await requestSender.getVersionedConfig({
        pathParams: { name: 'multi-level-parent', version: 1 },
        queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
      });

      expectResponseStatus(parentV1After, 200);
      expect(parentV1After.body.version).toBe(1); // Version unchanged
      const parentHashAfter = parentV1After.headers.etag;
      expect(parentHashAfter).toBeDefined();
      expect(parentHashAfter).not.toBe(parentHashBefore); // Hash changed

      // Verify grandparent hash also updated in-place (version still 1, hash changed)
      const grandparentV1After = await requestSender.getVersionedConfig({
        pathParams: { name: 'multi-level-grandparent', version: 1 },
        queryParams: { schemaId: 'https://mapcolonies.com/schemaWithNestedRef/v1' },
      });

      expectResponseStatus(grandparentV1After, 200);
      expect(grandparentV1After.body.version).toBe(1); // Version unchanged
      const grandparentHashAfter = grandparentV1After.headers.etag;
      expect(grandparentHashAfter).toBeDefined();
      expect(grandparentHashAfter).not.toBe(grandparentHashBefore); // Hash changed

      // Verify config content unchanged (only hashes changed)
      expect(parentV1After.body.config).toStrictEqual(parentV1Before.body.config);
      expect(grandparentV1After.body.config).toStrictEqual(grandparentV1Before.body.config);

      // CRITICAL: Verify grandparent hash is different from parent hash
      // This ensures the recursive CTE processed configs in correct topological order
      // If grandparent used stale parent hash, the hashes would be wrong
      expect(grandparentHashAfter).not.toBe(parentHashAfter);
    });
  });

  describe('GET /config/{name}/{version}/full', function () {
    describe('Happy Path', function () {
      it('should return 200 status code with comprehensive config metadata for a simple config', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // Verify structure and values using toMatchObject
        expect(response.body).toMatchObject({
          configName: 'config1',
          version: 1,
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          isLatest: false,
          createdBy: 'user1',
          hash: 'hash-config1-v1',
          rawConfig: { name: 'name1', age: 1 },
          schema: {
            id: 'https://mapcolonies.com/simpleSchema/v1',
            name: 'simpleSchema',
            version: 'v1',
            category: 'simpleSchema',
          },
          dependencies: {
            children: expect.any(Array),
            parents: expect.any(Array),
          },
          versions: {
            total: expect.any(Number),
            all: expect.any(Array),
          },
          stats: {
            configSize: expect.any(Number),
            keyCount: expect.any(Number),
            refCount: 0, // Simple config has no refs
            depth: expect.any(Number),
          },
        });

        // Verify additional properties exist
        expect(response.body).toEqual(
          expect.objectContaining({
            createdAt: expect.any(String),
            resolvedConfig: expect.any(Object),
            configWithDefaults: expect.any(Object),
            envVars: expect.any(Array),
          })
        );

        expect(response.body.versions.total).toBeGreaterThan(0);
      });

      it('should return 200 status code for latest version', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config2', version: 'latest' },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        expect(response.body).toMatchObject({
          version: 1, // config2 only has version 1
          isLatest: true,
          rawConfig: { name: 'name3', age: 3 },
        });
      });

      it('should return resolved config with refs dereferenced for config with references', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config-ref-2', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // Raw config should contain the $ref
        expect(response.body.rawConfig).toMatchObject({
          manager: {
            $ref: expect.objectContaining({
              configName: expect.any(String),
              schemaId: expect.any(String),
            }),
          },
        });

        // Resolved config should have refs dereferenced
        expect(response.body.resolvedConfig).toMatchObject({
          manager: {
            name: 'name4',
            age: 5,
          },
        });
        expect(JSON.stringify(response.body.resolvedConfig)).not.toContain('$ref');

        // Stats should reflect the reference
        expect(response.body.stats.refCount).toBeGreaterThan(0);
      });

      it('should return all versions for a config with multiple versions', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config4', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // config4 has versions 1, 2, and 3
        expect(response.body.versions).toMatchObject({
          total: 3,
          all: expect.arrayContaining([
            expect.objectContaining({ version: 1 }),
            expect.objectContaining({ version: 2 }),
            expect.objectContaining({ version: 3 }),
          ]),
        });

        expect(response.body.versions.all).toHaveLength(3);

        // Verify each version has required fields
        response.body.versions.all.forEach((versionInfo: unknown) => {
          expect(versionInfo).toEqual(
            expect.objectContaining({
              version: expect.any(Number),
              createdAt: expect.any(String),
              createdBy: expect.any(String),
              isLatest: expect.any(Boolean),
              hash: expect.any(String),
            })
          );
        });
      });

      it('should return schema defaults applied in configWithDefaults', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config-ref-1', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // configWithDefaults should have schema defaults applied
        expect(response.body.configWithDefaults).toHaveProperty('role', 'manager'); // default from schema
      });

      it('should return dependency trees for config with children', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config-ref-2', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // This config references config3, so it should have children
        expect(response.body.dependencies.children.length).toBeGreaterThan(0);
        expect(response.body.dependencies.children[0]).toEqual(
          expect.objectContaining({
            configName: expect.any(String),
            version: expect.any(Number),
            schemaId: expect.any(String),
            isLatest: expect.any(Boolean),
          })
        );
      });

      it('should return dependency trees for config with parents', async function () {
        // config3 is referenced by config-ref-2, so it should have parents
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config3', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // This config is referenced by others, so it should have parents
        expect(response.body.dependencies.parents.length).toBeGreaterThan(0);
      });
    });

    describe('Bad Path', function () {
      it('should return 404 status code when the config does not exist', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'non-existent-config', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 404);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 404 status code when the version does not exist', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config1', version: 999 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 404);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid version format', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config1', version: 'invalid' as unknown as number },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when schemaId is missing', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config1', version: 1 },
          queryParams: {} as { schemaId: string },
        });

        expectResponseStatus(response, 400);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when an internal error occurs', async function () {
        // Use a unique config name that won't be used by other tests
        const uniqueConfigName = `sad-path-test-${Date.now()}`;

        // Mock getConfigRecursive to fail for this specific config
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        const originalMethod = configRepo.getConfigRecursive.bind(configRepo);
        const spy = vi.spyOn(configRepo, 'getConfigRecursive').mockImplementation(async (name, schemaId, version) => {
          if (name === uniqueConfigName) {
            throw new Error('Database is down');
          }
          return originalMethod(name, schemaId, version);
        });

        const response = await requestSender.getFullConfig({
          pathParams: { name: uniqueConfigName, version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/simpleSchema/v1' },
        });

        expectResponseStatus(response, 500);
        expect(response).toSatisfyApiSpec();

        // Clean up spy immediately to prevent state pollution
        spy.mockRestore();
      });
    });

    describe('Complex Scenarios', function () {
      it('should handle configs with latest version references correctly', async function () {
        // config-ref-3 uses 'latest' version reference
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config-ref-3', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // Verify resolved config has no $ref markers
        expect(JSON.stringify(response.body.resolvedConfig)).not.toContain('$ref');

        // Verify the latest version of config3 was used (version 2)
        expect(response.body.resolvedConfig).toMatchObject({
          manager: {
            name: 'name5',
            age: 6,
          },
        });
      });

      it('should calculate correct stats for configs with references', async function () {
        const response = await requestSender.getFullConfig({
          pathParams: { name: 'config-ref-2', version: 1 },
          queryParams: { schemaId: 'https://mapcolonies.com/schemaWithRef/v1' },
        });

        expectResponseStatus(response, 200);
        expect(response).toSatisfyApiSpec();

        // Verify stats are calculated
        expect(response.body.stats).toMatchObject({
          configSize: expect.any(Number),
          keyCount: expect.any(Number),
          depth: expect.any(Number),
          refCount: 1, // config-ref-2 has 1 reference
        });

        expect(response.body.stats.configSize).toBeGreaterThan(0);
        expect(response.body.stats.keyCount).toBeGreaterThan(0);
        expect(response.body.stats.depth).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
