import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';
import { DependencyContainer } from 'tsyringe';
import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { RequestSender } from '../helpers/requestSender';

// import { SchemaRequestSender } from './helpers/requestSender';

describe('capabilities', function () {
  let requestSender: Awaited<ReturnType<typeof RequestSender>>;
  let dependencyContainer: DependencyContainer;
  beforeEach(async function () {
    const [app, container] = await getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
      useChild: true,
    });
    requestSender = await RequestSender('openapi3.yaml', app);
    dependencyContainer = container;
  });

  afterEach(async function () {
    const onSignal = dependencyContainer.resolve<() => Promise<void>>('onSignal');
    await onSignal();
  });

  describe('/capabilities', function () {
    describe('Happy Path', function () {
      it('should return 200 status code and the capabilities', async function () {
        const response = await requestSender.getCapabilities({});

        expect(response.status).toBe(httpStatusCodes.OK);

        expect(response).toSatisfyApiSpec();
      });
    });
  });
});
