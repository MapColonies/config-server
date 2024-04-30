import { Logger } from '@map-colonies/js-logger';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { HttpError } from '@map-colonies/error-express-handler';
import { SERVICES } from '../../common/constants';
import { SchemaManager } from '../models/schemaManager';
import { paths } from '../../openapiTypes';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from '../models/errors';

type GetSchemaTypes = paths['/schema']['get'];
type GetSchema = RequestHandler<
  undefined,
  GetSchemaTypes['responses']['200']['content']['application/json'],
  undefined,
  GetSchemaTypes['parameters']['query']
>;

type GetSchemasTypes = paths['/schema/tree']['get'];
type GetSchemas = RequestHandler<undefined, GetSchemasTypes['responses']['200']['content']['application/json']>;

@injectable()
export class SchemaController {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(SchemaManager) private readonly manager: SchemaManager) {}

  public getSchema: GetSchema = async (req, res, next) => {
    try {
      const schema = await this.manager.getSchema(req.query.id, req.query.shouldDereference);

      return res.status(httpStatus.OK).json(schema as unknown as GetSchemaTypes['responses']['200']['content']['application/json']);
    } catch (error) {
      if (error instanceof SchemaNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      } else if (error instanceof SchemaPathIsInvalidError) {
        (error as HttpError).status = httpStatus.BAD_REQUEST;
      }
      next(error);
    }
  };

  public getSchemasTree: GetSchemas = async (req, res) => {
    const schemasTree = await this.manager.getSchemas();
    return res.status(httpStatus.OK).json(schemasTree);
  };
}
