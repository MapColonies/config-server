import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { HttpError } from '@map-colonies/error-express-handler';
import { TypedRequestHandler } from '@common/interfaces';
import { SchemaManager } from '../models/schemaManager';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from '../models/errors';

@injectable()
export class SchemaController {
  public constructor(@inject(SchemaManager) private readonly manager: SchemaManager) {}

  public getSchema: TypedRequestHandler<'/schema', 'get'> = async (req, res, next) => {
    try {
      const schema = await this.manager.getSchema(req.query.id, req.query.shouldDereference);

      return res.status(httpStatus.OK).json(schema as unknown as Record<string, never>);
    } catch (error) {
      if (error instanceof SchemaNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      } else if (error instanceof SchemaPathIsInvalidError) {
        (error as HttpError).status = httpStatus.BAD_REQUEST;
      }
      next(error);
    }
  };

  public getSchemasTree: TypedRequestHandler<'/schema/tree', 'get'> = async (req, res) => {
    const schemasTree = await this.manager.getSchemas();
    return res.status(httpStatus.OK).json(schemasTree);
  };

  public getSchemasIndex: TypedRequestHandler<'/schema/index', 'get'> = async (req, res, next) => {
    try {
      const indexData = await this.manager.getSchemaIndex();

      // Set cache headers
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour

      return res.status(httpStatus.OK).json(indexData);
    } catch (error) {
      next(error);
    }
  };

  public getFullSchema: TypedRequestHandler<'/schema/full', 'get'> = async (req, res, next) => {
    try {
      const metadata = await this.manager.getFullSchemaMetadata(req.query.id);

      return res.status(httpStatus.OK).json(metadata);
    } catch (error) {
      if (error instanceof SchemaNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      } else if (error instanceof SchemaPathIsInvalidError) {
        (error as HttpError).status = httpStatus.BAD_REQUEST;
      }
      next(error);
    }
  };
}
