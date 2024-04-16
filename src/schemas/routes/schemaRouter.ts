import { Router } from 'express';
import { FactoryFunction } from 'tsyringe';
import { SchemaController } from '../controllers/schemaController';
import { SERVICES } from '../../common/constants';

export const schemaRouterFactory: FactoryFunction<Router> = (dependencyContainer) => {
  const router = Router();
  const controller = dependencyContainer.resolve(SchemaController);

  router.get('/tree', controller.getSchemasTree);
  router.get('/', controller.getSchema);

  return router;
};

export const SCHEMA_ROUTER_SYMBOL = Symbol('schemaRouterFactory');
