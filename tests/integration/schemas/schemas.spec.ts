import jsLogger from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { SchemaRequestSender } from './helpers/requestSender';

describe('schema', function () {
  let requestSender: SchemaRequestSender;
  let dependencyContainer: DependencyContainer;
  beforeEach(async function () {
    const [app, container] = await getApp({
      override: [{ token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } }],
      useChild: true,
    });
    requestSender = new SchemaRequestSender(app);
    dependencyContainer = container;
  });

  afterEach(async function () {
    const onSignal = dependencyContainer.resolve<() => Promise<void>>('onSignal');
    await onSignal();
  });

  describe('/schema', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the schemas tree', async function () {
        const response = await requestSender.getSchemas();

        expect(response.status).toBe(httpStatusCodes.OK);

        expect(response).toSatisfyApiSpec();
      });
    });
  });

  describe('/schema/{path}', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the schema', async function () {
        const response = await requestSender.getSchema({ id: 'https://mapcolonies.com/common/boilerplate/v1' });
        expect(response.status).toBe(httpStatusCodes.OK);

        expect(response).toSatisfyApiSpec();
        expect(response.body).toHaveProperty('$id', 'https://mapcolonies.com/common/boilerplate/v1');
      });

      it('should return 200 status code and the dereferenced schema', async function () {
        const response = await requestSender.getSchema({ id: 'https://mapcolonies.com/common/boilerplate/v1', shouldDereference: true });
        expect(response.status).toBe(httpStatusCodes.OK);

        expect(response).toSatisfyApiSpec();
        expect(response.body).toHaveProperty('$id', 'https://mapcolonies.com/common/boilerplate/v1');
      });
    });

    describe('Bad Path', function () {
      it('should return 400 status code if the path is invalid', async function () {
        const response = await requestSender.getSchema({ id: 'https://mapcolonies.com/../avi/..' });
        expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      });

      it('should return 404 status code if the schema is not found', async function () {
        const response = await requestSender.getSchema({ id: 'https://mapcolonies.com/avi' });
        expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      });
    });
  });
});
