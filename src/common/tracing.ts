import { Tracing } from '@map-colonies/telemetry';
import config from 'config';
import { type Attributes, type Span, type SpanOptions, SpanStatusCode, trace } from '@opentelemetry/api';
import { IGNORED_INCOMING_TRACE_ROUTES, IGNORED_OUTGOING_TRACE_ROUTES, SERVICE_NAME, schemasPackageVersion } from './constants';

function maskSchemasPath(path: string): string {
  const split = path.split('node_modules/');
  if (split.length > 1) {
    return split[1];
  }
  return '';
}

const fsFunctionMap = new Map([
  ['existsSync', 'file-checked'],
  ['readFile', 'file-read'],
  ['readdir', 'directory'],
]);

/* eslint-disable @typescript-eslint/naming-convention */
const tracing = new Tracing({attributes: { 'schemas.version': schemasPackageVersion },
  autoInstrumentationsConfigMap: {
    '@opentelemetry/instrumentation-http': {
      ignoreIncomingRequestHook: (request): boolean =>
        !(request.url?.startsWith(config.get('server.apiPrefix')) ?? false) ||
        IGNORED_INCOMING_TRACE_ROUTES.some((route) => request.url !== undefined && route.test(request.url)),
      ignoreOutgoingRequestHook: (request): boolean =>
        IGNORED_OUTGOING_TRACE_ROUTES.some((route) => typeof request.path === 'string' && route.test(request.path)),
    },
    '@opentelemetry/instrumentation-fs': {
      requireParentSpan: true,
      endHook: (functionName, info): boolean => {
        const key = fsFunctionMap.get(functionName);
        if (key !== undefined && typeof info.args[0] === 'string') {
          const masked = maskSchemasPath(info.args[0]);
          if (masked) {
            info.span.setAttribute(key, masked);
          }
        }
        return true;
      },
      enabled: true,
    },
    '@opentelemetry/instrumentation-express': {
      requestHook: (span, info): void => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const operationId = info.request?.openapi?.schema?.operationId;
        if (info.layerType === 'request_handler' && typeof operationId === 'string') {
          span.updateName('request handler - ' + operationId);
          span.setAttribute('http.openapi.operation-id', operationId);
        }
      },
    },
  },
});
/* eslint-enable @typescript-eslint/naming-convention */

tracing.start();

const tracer = trace.getTracer(SERVICE_NAME);

export { tracing };

export function callWithSpan<T>(fn: (span?: Span) => T, spanName: string, spanOptions?: SpanOptions): T  {
  return tracer.startActiveSpan(spanName, spanOptions ?? {}, (span) => {
    try {
      const result = fn(span);
      if (result instanceof Promise) {
        // return new Promise<T>((resolve, reject) => {
        result
          .then(() => {
            handleSpanOnSuccess(span);
            // return resolve(r);
          })
          .catch((e) => {
            handleSpanOnError(span, e);
            // return reject(e);
            // });
          });
        return result;
      }
      handleSpanOnSuccess(span);
      return result;
    } catch (error) {
      handleSpanOnError(span, error);
      throw error;
    }
  });
}

export function handleSpanOnSuccess(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function handleSpanOnError(span: Span, error?: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR });

  if (error instanceof Error) {
    span.recordException(error);
  }

  span.end();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function newWithSpanV4(options: { spanName?: string; attributes?: Attributes } = {}) {
  return function <This extends {constructor: {name: string}}, Args extends any[]>(
    target: This,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(this: This, ...args: Args) => any>
  ): TypedPropertyDescriptor<(this: This, ...args: Args) => any> {
    const originalMethod = descriptor.value;

    if (originalMethod === undefined) {
      throw new Error('Decorated method is undefined');
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    descriptor.value = function (this: This, ...args: Args): any {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return callWithSpan(() => originalMethod.call(this, ...args), options.spanName ?? `${target.constructor.name}:${String(propertyKey)}`, { attributes: options.attributes });
    };

    return descriptor;
  };
}
