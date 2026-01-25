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
});
