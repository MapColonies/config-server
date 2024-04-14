import { Logger } from '@map-colonies/js-logger';
import { RequestHandler } from 'express';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { SERVICES } from '../../common/constants';
import { SchemaManager } from '../models/schemaManager';
import {} from '@apidevtools/json-schema-ref-parser'

import { paths } from '../../schema';


type GetSchemaTypes = paths['/schema/{path}']['get'];
type GetSchema = RequestHandler<GetSchemaTypes['parameters']['path'], GetSchemaTypes['responses']['200']['content']['application/json'], undefined,Required<GetSchemaTypes['parameters']['query']>>;

type GetSchemasTypes = paths['/schema']['get'];
type GetSchemas = RequestHandler<undefined, GetSchemasTypes['responses']['200']['content']['application/json']>;

@injectable()
export class SchemaController {
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger, @inject(SchemaManager) private readonly manager: SchemaManager) {}

  public getSchema: GetSchema = async (req, res) => {
    const schema = await this.manager.getSchema('https://mapcolonies.com/' + req.params.path, req.query?.shouldDereference);
    return res.status(httpStatus.OK).json(schema as unknown as GetSchemaTypes['responses']['200']['content']['application/json']);
  };

  public getSchemas: GetSchemas = async (req, res) => {
    const schemasTree = await this.manager.getSchemas();
    return res.status(httpStatus.OK).json(schemasTree);
  };
}
