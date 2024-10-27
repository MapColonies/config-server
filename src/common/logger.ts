import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { get } from 'lodash';
import jsLogger, { Logger, LoggerOptions } from '@map-colonies/js-logger';
import { getOtelMixin } from '@map-colonies/telemetry';
import { NextFunction, Request, Response } from 'express';
import { DependencyContainer } from 'tsyringe';
import { SERVICES } from './constants';
import { IConfig } from './interfaces';

const logContext = new AsyncLocalStorage<object>();

export function addOperationIdToLog(req: IncomingMessage, res: ServerResponse, loggableObject: Record<string, unknown>): unknown {
  const operationId = get(req, 'openapi.schema.operationId') as string | undefined;
  if (operationId !== undefined) {
    loggableObject['operationId'] = operationId;
  }
  return loggableObject;
}

export function enrichLogContext(values: object): void {
  const store = logContext.getStore();
  if (store) {
    Object.assign(store, values);
  }
}

export function loggerFactory(container: DependencyContainer): Logger {
  const config = container.resolve<IConfig>(SERVICES.CONFIG);
  const loggerConfig = config.get<LoggerOptions>('telemetry.logger');

  const logger = jsLogger({
    ...loggerConfig,
    mixin: (mergeObj, level) => {
      const otelMixin = getOtelMixin();
      const store = logContext.getStore();
      return { ...otelMixin(mergeObj, level), ...store };
    },
  });

  return logger;
}

export function logContextInjectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  logContext.run({}, () => {
    next();
  });
}

export function logEnrichmentParamMiddlewareFactory(
  logEntry: string
): (req: Request, res: Response, next: NextFunction, paramValue: unknown) => void {
  return function (req: Request, res: Response, next: NextFunction, paramValue: unknown): void {
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (paramValue) {
      enrichLogContext({ [logEntry]: paramValue });
    }
    next();
  };
}
