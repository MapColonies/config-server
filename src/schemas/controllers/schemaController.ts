import { Logger } from '@map-colonies/js-logger';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { HttpError } from '@map-colonies/error-express-handler';
import { SERVICES } from '../../common/constants';
import { SchemaManager } from '../models/schemaManager';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from '../models/errors';
import { TypedRequestHandler } from '../../common/interfaces';

@injectable()
export class SchemaController {
  public constructor(
    @inject(SERVICES.LOGGER) private readonly logger: Logger,
    @inject(SchemaManager) private readonly manager: SchemaManager
  ) {}

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
}
