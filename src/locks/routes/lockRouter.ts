import { Router } from 'express';
import { FactoryFunction } from 'tsyringe';
import { logEnrichmentParamMiddlewareFactory } from '@common/logger';
import { LockController } from '../controllers/lockController';

export const lockRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(LockController);

  router.param('key', logEnrichmentParamMiddlewareFactory('lockKey'));
  router.param('callerId', logEnrichmentParamMiddlewareFactory('callerId'));

  router.post('/', controller.acquireLock);
  router.delete('/:key/:callerId', controller.releaseLock);

  return router;
};

export const LOCK_ROUTER_SYMBOL = Symbol('lockRouterFactory');
