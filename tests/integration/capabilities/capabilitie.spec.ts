import jsLogger from '@map-colonies/js-logger';
import { trace } from '@opentelemetry/api';
import httpStatusCodes from 'http-status-codes';

import { getApp } from '../../../src/app';
import { SERVICES } from '../../../src/common/constants';
import { SchemaRequestSender } from './helpers/requestSender';

describe('capabilities', function () {
  let requestSender: SchemaRequestSender;
  beforeEach(function () {
    const app = getApp({
      override: [
        { token: SERVICES.LOGGER, provider: { useValue: jsLogger({ enabled: false }) } },
        { token: SERVICES.TRACER, provider: { useValue: trace.getTracer('testTracer') } },
      ],
      useChild: true,
    });
    requestSender = new SchemaRequestSender(app);
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
