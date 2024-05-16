import 'jest-extended';
import jsLogger, { Logger } from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { faker } from '@faker-js/faker';
import { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import { ConfigRepository } from '../../../src/configs/repositories/configRepository';
import { SchemaManager } from '../../../src/schemas/models/schemaManager';
import { Drizzle } from '../../../src/db/createConnection';
import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { configs } from '../../../src/configs/models/config';
import { ConfigRequestSender } from './helpers/requestSender';
import { configsMockData, schemaWithRef, simpleSchema } from './helpers/data';

async function getSchemaMock(id: string): Promise<JSONSchema> {
  if (id === schemaWithRef.$id) {
    return Promise.resolve(schemaWithRef);
  } else if (id === simpleSchema.$id) {
    return Promise.resolve(simpleSchema);
  } else {
    throw new Error('Schema not found');
  }
}

describe('config', function () {
  let requestSender: ConfigRequestSender;
  let dependencyContainer: DependencyContainer;
  beforeAll(async function () {
    const [app, container] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
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
  });

  afterAll(async function () {
    const onSignal = dependencyContainer.resolve<() => Promise<void>>('onSignal');
    await onSignal();
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
        const response = await requestSender.getConfigs({ config_name: 'not_exists' });

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
    });

    describe('Bad Path', function () {
      it('should return 404 status code when the config not exists', async function () {
        const response = await requestSender.getConfigByName('not_exists');

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
          configName: 'newConfig1',
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
    });

    describe('Bad Path', function () {
      it('should return 400 status code when using invalid version', async function () {
        const response = await requestSender.postConfig({
          configName: 'newConfig2',
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
          configName: 'newConfig2',
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
          configName: 'newConfig2',
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

      it('should return 409 status code when trying to post a new version of a config that does not exists', async function () {
        const response = await requestSender.postConfig({
          configName: 'not_exists',
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
    });

    describe('Sad Path', function () {
      it('should return 500 status code when the database is down', async function () {
        const configRepo = dependencyContainer.resolve(ConfigRepository);
        jest.spyOn(configRepo, 'createConfig').mockRejectedValueOnce(new Error('Database is down'));

        const response = await requestSender.postConfig({
          configName: 'newConfig3',
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