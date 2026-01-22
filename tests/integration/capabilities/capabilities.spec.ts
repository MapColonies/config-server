import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import { jsLogger } from '@map-colonies/js-logger';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { createRequestSender, RequestSender } from '@map-colonies/openapi-helpers/requestSender';
import { paths, operations } from '@openapi';
import { getApp } from '@src/app';
import { SERVICES } from '@common/constants';

describe('capabilities', function () {
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

  describe('/capabilities', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the capabilities', async function () {
        const response = await requestSender.getCapabilities();

        expect(response.status).toBe(httpStatusCodes.OK);

        expect(response).toSatisfyApiSpec();
      });
    });
  });
});
