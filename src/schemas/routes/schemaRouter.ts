import { Router } from 'express';
import { FactoryFunction } from 'tsyringe';
import { SchemaController } from '../controllers/schemaController';

export const schemaRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(SchemaController);

  router.get('/', controller.getSchemas);
  router.get('/:path', controller.getSchema);

  return router;
};

export const SCHEMA_ROUTER_SYMBOL = Symbol('schemaRouterFactory');
