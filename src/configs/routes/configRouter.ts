import { Router } from 'express';
import { FactoryFunction } from 'tsyringe';
import { ConfigController } from '../controllers/configController';

export const configRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(ConfigController);

  router.get('/', controller.getConfig);
  router.post('/', controller.postConfig);
  router.get('/:name', controller.getConfigByName);
  router.get('/:name/:version', controller.getConfigByVersion);

  return router;
};

export const CONFIG_ROUTER_SYMBOL = Symbol('configRouterFactory');
