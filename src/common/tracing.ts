import { Tracing } from '@map-colonies/telemetry';
import config from 'config';
import { get } from 'lodash';
import { type Attributes, type Span, type SpanOptions, SpanStatusCode, trace } from '@opentelemetry/api';
import { IGNORED_INCOMING_TRACE_ROUTES, IGNORED_OUTGOING_TRACE_ROUTES, SERVICE_NAME, schemasPackageVersion } from './constants';

function maskSchemasPath(path: string): string {
  const split = path.split('node_modules/');
  if (split[1] !== undefined) {
    return split[1];
  }
  return '';
}

const fsFunctionMap = new Map([
  ['existsSync', 'file-checked'],
  ['readFile', 'file-read'],
  ['readdir', 'directory'],
]);

const tracing = new Tracing({
  attributes: { 'schemas.version': schemasPackageVersion },
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
        const operationId = get(info, 'request.openapi.schema.operationId') as string | undefined;
        // rule disabled because the enum is not exported from the package
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        if (info.layerType === 'request_handler' && typeof operationId === 'string' && operationId !== '') {
          span.updateName('request handler - ' + operationId);
          span.setAttribute('http.openapi.operation-id', operationId);
        }
      },
    },
  },
});

tracing.start();

const tracer = trace.getTracer(SERVICE_NAME);

export { tracing };

export function callWithSpan<T>(fn: (span: Span) => T, spanName: string, spanOptions?: SpanOptions): T {
  return tracer.startActiveSpan(spanName, spanOptions ?? {}, (span) => {
    try {
      const result = fn(span);
      if (result instanceof Promise) {
        result
          .then(() => {
            handleSpanOnSuccess(span);
          })
          .catch((e) => {
            handleSpanOnError(span, e);
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
export function withSpan<Args extends any[]>(
  options: { spanName?: string; attributes?: Attributes; postSpanCreationHook?: (span: Span, args: Args) => void } = {}
) {
  return function <This extends { constructor: { name: string } }>(
    target: This,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<(this: This, ...args: Args) => any>
  ): TypedPropertyDescriptor<(this: This, ...args: Args) => any> {
    const originalMethod = descriptor.value;

    if (originalMethod === undefined) {
      throw new Error('Decorated method is undefined');
    }

    descriptor.value = function (this: This, ...args: Args): any {
      return callWithSpan(
        (span) => {
          if (options.postSpanCreationHook !== undefined) {
            options.postSpanCreationHook(span, args);
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return originalMethod.call(this, ...args);
        },
        options.spanName ?? `${target.constructor.name}:${String(propertyKey)}`,
        { attributes: options.attributes }
      );
    };

    return descriptor;
  };
}

export function setSpanAttributes(attributes: Attributes): void {
  const currentSpan = trace.getActiveSpan();
  if (currentSpan !== undefined) {
    currentSpan.setAttributes(attributes);
  }
}
