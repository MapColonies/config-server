import 'jest-extended';
import 'jest-openapi';
import 'jest-sorted';

import fs from 'node:fs';
import jsLogger, { Logger } from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { faker } from '@faker-js/faker';
import { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import { ConfigRepository } from '@src/configs/repositories/configRepository';
import { SchemaManager } from '@src/schemas/models/schemaManager';
import { Drizzle } from '@src/db/createConnection';
import { getApp } from '@src/app';
import { ConfigManager } from '@src/configs/models/configManager';
import { SERVICES } from '@common/constants';
import { Config, configs, configsRefs } from '@src/configs/models/config';
import * as utils from '@common/utils';
import { SchemaNotFoundError } from '@src/schemas/models/errors';
import { ConfigRequestSender } from './helpers/requestSender';
import { configsMockData, refs, schemaWithRef, simpleSchema, primitiveRefSchema, primitiveSchema } from './helpers/data';

jest.mock('../../../src/common/utils', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    __esModule: true,
    ...jest.requireActual('../../../src/common/utils'),
  };
});

async function getSchemaMock(id: string): Promise<JSONSchema> {
  switch (id) {
    case schemaWithRef.$id:
      return Promise.resolve(schemaWithRef);
    case simpleSchema.$id:
      return Promise.resolve(simpleSchema);
    case primitiveSchema.$id:
      return Promise.resolve(primitiveSchema);
    case primitiveRefSchema.$id:
      return Promise.resolve(primitiveRefSchema);
    default:
      throw new SchemaNotFoundError('Schema not found');
  }
}

describe('config', function () {
  let requestSender: ConfigRequestSender;
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
              jest.spyOn(manager, 'getSchema').mockImplementation(getSchemaMock);
              return manager;
            },
          },
        },
      ],
      useChild: true,
    });
    requestSender = new ConfigRequestSender(app);
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
      jest.spyOn(utils, 'filesTreeGenerator').mockImplementationOnce(async function* () {
        await Promise.resolve();
        yield {
          name: 'v1.configs.json',
          parentPath: 'schemas/build/schemas/simpleSchema',
        } as fs.Dirent;
      });

      const fsSpy = jest.spyOn(fs, 'readFileSync');

      const configManager = dependencyContainer.resolve(ConfigManager);

      fsSpy.mockReturnValueOnce(JSON.stringify([{ name: 'default-simple-config', value: { name: 'name1', age: 1 } }]));

      await configManager.insertDefaultConfigs();

      const defaultConfig = await configManager.getConfig('default-simple-config', 1);
      expect(defaultConfig).toHaveProperty('config', { name: 'name1', age: 1 });
    });

    it('should not insert config if it already exists', async function () {
      jest.spyOn(utils, 'filesTreeGenerator').mockImplementationOnce(async function* () {
        await Promise.resolve();
        yield {
          name: 'v1.configs.json',
          parentPath: 'schemas/build/schemas/simpleSchema',
        } as fs.Dirent;
      });

      const fsSpy = jest.spyOn(fs, 'readFileSync');

      const configManager = dependencyContainer.resolve(ConfigManager);
      await configManager.createConfig({
        config: { name: 'name1', age: 1 },
        configName: 'already-exists',
        schemaId: 'https://mapcolonies.com/simpleSchema/v1',
        version: 1,
      });

      fsSpy.mockReturnValueOnce(JSON.stringify([{ name: 'already-exists', value: { name: 'name1', age: 1 } }]));

      await configManager.insertDefaultConfigs();

      const defaultConfig = await configManager.getConfig('default-simple-config');
      expect(defaultConfig).toHaveProperty('config', { name: 'name1', age: 1 });
      expect(defaultConfig).toHaveProperty('version', 1);
    });

    it('should throw an error if there is a ref for a config that does not exists', async function () {
      jest.spyOn(utils, 'filesTreeGenerator').mockImplementationOnce(async function* () {
        await Promise.resolve();
        yield {
          name: 'v1.configs.json',
          parentPath: 'schemas/build/schemas/simpleSchema',
        } as fs.Dirent;
      });

      const fsSpy = jest.spyOn(fs, 'readFileSync');

      const configManager = dependencyContainer.resolve(ConfigManager);

      fsSpy.mockReturnValueOnce(JSON.stringify([{ name: 'bad-ref', value: { $ref: { configName: 'avi', version: 'latest' } } }]));

      const action = configManager.insertDefaultConfigs();

      await expect(action).rejects.toThrow();
    });

    it('should insert all the default configs in the current schemas package', async function () {
      const configManager = dependencyContainer.resolve(ConfigManager);

      const action = configManager.insertDefaultConfigs();

      await expect(action).resolves.not.toThrow();
    });
  });

  describe('GET /config', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the configs', async function () {
        const response = await requestSender.getConfigs({});

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).not.toHaveLength(0);
      });

      it('should return 200 status code and the configs with pagination', async function () {
        const response = await requestSender.getConfigs({ limit: 1, offset: 1 });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).toHaveLength(1);
        expect(response.body).toHaveProperty('total');
      });

      it('should return 200 status code and filter the configs', async function () {
        /* eslint-disable @typescript-eslint/naming-convention */
        const response = await requestSender.getConfigs({
          config_name: 'config2',
          version: 1,
          schema_id: 'https://mapcolonies.com/simpleSchema/v1',
          created_by: 'user3',
          created_at_gt: '2000-01-01T00:00:00Z',
          created_at_lt: '2002-01-02T00:00:00Z',
        });
        /* eslint-enable @typescript-eslint/naming-convention */

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).toHaveLength(1);
      });

      it('should return 200 status code when using full text search', async function () {
        const response = await requestSender.getConfigs({ q: 'config2' });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).toHaveLength(1);
      });

      it('should return 200 and the latest version of the config', async function () {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await requestSender.getConfigs({ version: 'latest', config_name: 'config1' });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        /* eslint-disable @typescript-eslint/no-unsafe-member-access */
        expect(response.body.configs).not.toHaveLength(0);
        expect(response.body.configs[0]).toHaveProperty('version', 2);
        /* eslint-enable @typescript-eslint/no-unsafe-member-access */
      });

      it('should return 200 status code and empty array if no results have returned', async function () {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const response = await requestSender.getConfigs({ config_name: 'not-exists' });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).toHaveLength(0);
        expect(response.body).toHaveProperty('total', 0);
      });

      it('should return 200 and filter the configs by version', async function () {
        const response = await requestSender.getConfigs({ version: 1 });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).not.toHaveLength(0);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).toSatisfyAll((config) => config.version === 1);
      });

      it('should return 200 and sort the configs by config name', async function () {
        const response = await requestSender.getConfigs({ sort: ['config-name:asc'] });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.configs).toBeSortedBy('configName', { descending: false });
      });

      it('should return 200 and sort the configs by name and version', async function () {
        const response = await requestSender.getConfigs({ sort: ['config-name:asc', 'version:desc'] });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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
        const response = await requestSender.getConfigs({ created_at_gt: 'invalid' });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid version', async function () {
        const response = await requestSender.getConfigs({ version: 'invalid' as unknown as number });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid limit', async function () {
        const response = await requestSender.getConfigs({ limit: 'invalid' as unknown as number });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if a bad sort query option is provided', async function () {
        const response = await requestSender.getConfigs({ sort: ['config-name:ascc'] });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 422 status code when a sort option is repeated', async function () {
        const response = await requestSender.getConfigs({ sort: ['config-name:asc', 'config-name:desc'] });

        expect(response.status).toBe(httpStatusCodes.UNPROCESSABLE_ENTITY);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        jest.spyOn(configRepo, 'getConfigs').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.getConfigs({});

        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('GET /config/{name}', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the latest config', async function () {
        const response = await requestSender.getConfigByName('config1');

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.version).toBe(2);
      });

      it('should return 200 status code and the dereferenced config', async function () {
        const response = await requestSender.getConfigByName('config-ref-2', { shouldDereference: true });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.config).toStrictEqual({
          manager: {
            name: 'name4',
            age: 5,
          },
        });
      });
    });

    describe('Bad Path', function () {
      it('should return 400 status code when using invalid config name', async function () {
        const response = await requestSender.getConfigByName('Invalid_name');

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });
      it('should return 404 status code when the config not exists', async function () {
        const response = await requestSender.getConfigByName('not-exists');

        expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 404 status code when the config not exists in a dereferenced request', async function () {
        const response = await requestSender.getConfigByName('not-exists', { shouldDereference: true });

        expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        jest.spyOn(configRepo, 'getConfig').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.getConfigByName('config1');

        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('GET /config/{name}/{version}', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the configs', async function () {
        const response = await requestSender.getConfigByVersion('config1', 1);

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.version).toBe(1);
      });

      it('should return 200 status code and the latest config', async function () {
        const response = await requestSender.getConfigByVersion('config1', 'latest');

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.version).toBe(2);
      });

      it('should return 200 status code and the dereferenced config', async function () {
        const response = await requestSender.getConfigByVersion('config-ref-2', 1, { shouldDereference: true });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(response.body.config).toStrictEqual({
          manager: {
            name: 'name4',
            age: 5,
          },
        });
      });

      it('should return 200 status code and the dereferenced config without any refs inside', async function () {
        const response = await requestSender.getConfigByVersion('config-ref-3', 1, { shouldDereference: true });

        expect(response.status).toBe(httpStatusCodes.OK);
        expect(response).toSatisfyApiSpec();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(JSON.stringify(response.body.config)).not.toContain('$ref');
      });
    });

    describe('Bad Path', function () {
      it('should return 404 status code when the config not exists', async function () {
        const response = await requestSender.getConfigByVersion('config1', 3);

        expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid version', async function () {
        const response = await requestSender.getConfigByVersion('config1', 'invalid' as unknown as number);

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        jest.spyOn(configRepo, 'getConfig').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.getConfigByVersion('config1', 1);

        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('POST /config', function () {
    describe('Happy Path', function () {
      it('should return 201 and create the config', async function () {
        const response = await requestSender.postConfig({
          configName: 'new-config1',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: {
            name: faker.person.firstName(),
            age: faker.number.int(),
          },
        });

        expect(response.status).toBe(httpStatusCodes.CREATED);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create the config when a previous one already exists', async function () {
        const response = await requestSender.postConfig({
          configName: 'config1',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 2,
          config: {
            name: faker.person.firstName(),
            age: faker.number.int(),
          },
        });

        expect(response.status).toBe(httpStatusCodes.CREATED);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create the config with refs', async function () {
        const response = await requestSender.postConfig({
          configName: 'config-with-ref',
          schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
          version: 1,
          config: {
            manager: {
              $ref: {
                configName: 'config3',
                version: 'latest',
              },
            },
            role: 'unknown',
          },
        });

        expect(response.status).toBe(httpStatusCodes.CREATED);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create the config with refs with primitives', async function () {
        const response = await requestSender.postConfig({
          configName: 'config-with-primitive-ref',
          schemaId: 'https://mapcolonies.com/primitiveRefSchema/v1',
          version: 1,
          config: {
            primitive: {
              $ref: {
                configName: 'primitive-config',
                version: 1,
              },
            },
          },
        });

        expect(response.status).toBe(httpStatusCodes.CREATED);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 201 and create a config that is a root ref to another config', async function () {
        const response = await requestSender.postConfig({
          configName: 'config-root-ref',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: {
            $ref: {
              configName: 'config1',
              version: 'latest',
            },
          },
        });

        expect(response.status).toBe(httpStatusCodes.CREATED);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Bad Path', function () {
      it('should return 400 status code when using invalid version', async function () {
        const response = await requestSender.postConfig({
          configName: 'new-config2',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 'invalid' as unknown as number,
          config: {
            name: faker.person.firstName(),
            age: faker.number.int(),
          },
        });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid schema id', async function () {
        const response = await requestSender.postConfig({
          configName: 'new-config2',
          schemaId: 'invalid',
          version: 1,
          config: {
            name: faker.person.firstName(),
            age: faker.number.int(),
          },
        });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 status code when using invalid config', async function () {
        const response = await requestSender.postConfig({
          configName: 'new-config2',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: {
            name: faker.person.firstName(),
            age: 'invalid',
          },
        });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if a ref is does not exist in the database', async function () {
        const response = await requestSender.postConfig({
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
        });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if a ref is not valid', async function () {
        const response = await requestSender.postConfig({
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
        });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 400 if the schemaId of the config does not exist', async function () {
        const response = await requestSender.postConfig({
          configName: 'config-not-exists',
          schemaId: 'https://mapcolonies.com/not-exists/v1',
          version: 1,
          config: {
            manager: 'null',
            role: 'unknown',
          },
        });

        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 status code when trying to post a new version of a config that does not exists', async function () {
        const response = await requestSender.postConfig({
          configName: 'not-exists',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 2,
          config: {
            name: faker.person.firstName(),
            age: faker.number.int(),
          },
        });

        expect(response.status).toBe(httpStatusCodes.CONFLICT);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 status code when trying to post a version that already exists', async function () {
        const response = await requestSender.postConfig({
          configName: 'config1',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: {
            name: faker.person.firstName(),
            age: faker.number.int(),
          },
        });

        expect(response.status).toBe(httpStatusCodes.CONFLICT);
        expect(response).toSatisfyApiSpec();
      });

      it('should return 409 status code when the schema provided does not match the schema of the last config', async function () {
        const response = await requestSender.postConfig({
          schemaId: 'https://mapcolonies.com/primitiveSchema/v1',
          configName: 'config4',
          version: 3,
          config: { string: 'string' },
        });

        expect(response.status).toBe(httpStatusCodes.CONFLICT);
        expect(response).toSatisfyApiSpec();
      });
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        jest.spyOn(configRepo, 'createConfig').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.postConfig({
          configName: 'new-config3',
          schemaId: 'https://mapcolonies.com/simpleSchema/v1',
          version: 1,
          config: {
            name: faker.person.firstName(),
            age: faker.number.int(),
          },
        });

        expect(response.status).toBe(httpStatusCodes.INTERNAL_SERVER_ERROR);
        expect(response).toSatisfyApiSpec();
      });
    });
  });
});
