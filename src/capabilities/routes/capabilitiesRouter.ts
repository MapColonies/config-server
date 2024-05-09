import { Router } from 'express';
import { FactoryFunction } from 'tsyringe';
import { CapabilitiesController } from '../controllers/capabilitiesController';

export const capabilitiesRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(CapabilitiesController);

  router.get('/', controller.getCapabilities);

  return router;
};

export const CAPABILITIES_ROUTER_SYMBOL = Symbol('capabilitiesRouterFactory');
