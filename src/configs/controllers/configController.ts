import { formatISO } from 'date-fns';
import httpStatus from 'http-status-codes';
import { injectable, inject } from 'tsyringe';
import { HttpError } from '@map-colonies/error-express-handler';
import type { components } from '@openapi';
import { TypedRequestHandler } from '@common/interfaces';
import { ConfigManager } from '../models/configManager';
import { Config, SortOption, SortableFields } from '../models/config';
import {
  ConfigNotFoundError,
  ConfigSchemaMismatchError,
  ConfigValidationError,
  ConfigVersionMismatchError,
  SortQueryRepeatError,
} from '../models/errors';
import { SchemaNotFoundError } from '../../schemas/models/errors';
import { enrichLogContext } from '../../common/logger';

function configMapper(config: Config): components['schemas']['config'] {
  const { configSchemaVersion, ...rest } = config;
  return {
    ...rest,
    createdAt: formatISO(config.createdAt),
  };
}

const sortFieldsMap = new Map<string, SortableFields>(
  Object.entries({
    'config-name': 'configName',
    version: 'version',
    'created-at': 'createdAt',
    'schema-id': 'schemaId',
    'created-by': 'createdBy',
  })
);

function sortOptionParser(sortArray: components['parameters']['SortQuery']): SortOption[] {
  const parsedOptions: SortOption[] = [];
  const fieldSet = new Set<string>();

  for (const option of sortArray) {
    const [field, order] = option.split(':') as [string, 'asc' | 'desc' | undefined]; // we assume that the options are already validated by the openapi validator;

    if (fieldSet.has(field)) {
      throw new SortQueryRepeatError(`Duplicate field in sort query: ${field}`);
    }
    fieldSet.add(field);

    const parsedField = sortFieldsMap.get(field) as SortableFields;

    parsedOptions.push({ field: parsedField, order: order ?? 'asc' });
  }

  return parsedOptions;
}

@injectable()
export class ConfigController {
  public constructor(@inject(ConfigManager) private readonly manager: ConfigManager) {}

  public getConfigs: TypedRequestHandler<'/config', 'get'> = async (req, res, next) => {
    try {
      const { sort, ...options } = req.query ?? {};

      const getConfigsResult = await this.manager.getConfigs({ ...options, sort: sort ? sortOptionParser(sort) : undefined });
      const formattedConfigs = getConfigsResult.configs.map(configMapper);
      return res.status(httpStatus.OK).json({ configs: formattedConfigs, total: getConfigsResult.totalCount });
    } catch (error) {
      if (error instanceof SortQueryRepeatError) {
        (error as HttpError).status = httpStatus.UNPROCESSABLE_ENTITY;
      }
      next(error);
    }
  };

  public getConfigByVersion: TypedRequestHandler<'/config/{name}/{version}', 'get'> = async (req, res, next) => {
    const version = req.params.version !== 'latest' ? req.params.version : undefined;

    try {
      const config = await this.manager.getConfig(req.params.name, req.query.schemaId, version, req.query.shouldDereference);

      // ETag support: Use the config's hash as the ETag
      const etag = config.hash;

      // Check If-None-Match header for conditional GET
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        // Config hasn't changed, return 304 Not Modified
        return res.status(httpStatus.NOT_MODIFIED).end();
      }

      // Set ETag header and return the config
      res.setHeader('ETag', etag);
      return res.status(httpStatus.OK).json(configMapper(config));
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      }

      next(error);
    }
  };

  public getFullConfig: TypedRequestHandler<'/config/{name}/{version}/full', 'get'> = async (req, res, next) => {
    const version = req.params.version !== 'latest' ? req.params.version : undefined;

    try {
      const fullMetadata = await this.manager.getFullConfigMetadata(req.params.name, req.query.schemaId, version);

      return res.status(httpStatus.OK).json(fullMetadata);
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      }
      next(error);
    }
  };

  public postConfig: TypedRequestHandler<'/config', 'post'> = async (req, res, next) => {
    try {
      enrichLogContext({ configName: req.body.configName, schemaId: req.body.schemaId });

      await this.manager.createConfig(req.body);
      return res.status(httpStatus.CREATED).json();
    } catch (error) {
      if (error instanceof ConfigValidationError || error instanceof ConfigNotFoundError || error instanceof SchemaNotFoundError) {
        (error as HttpError).status = httpStatus.BAD_REQUEST;
      } else if (error instanceof ConfigVersionMismatchError || error instanceof ConfigSchemaMismatchError) {
        (error as HttpError).status = httpStatus.CONFLICT;
      }
      next(error);
    }
  };
}
