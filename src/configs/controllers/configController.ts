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
  return {
    ...config,
    createdAt: formatISO(config.createdAt),
  };
}

const sortFieldsMap = new Map<string, SortableFields>(
  Object.entries({
    /* eslint-disable @typescript-eslint/naming-convention */
    'config-name': 'configName',
    version: 'version',
    'created-at': 'createdAt',
    'schema-id': 'schemaId',
    'created-by': 'createdBy',
    /* eslint-enable @typescript-eslint/naming-convention */
  })
);

function sortOptionParser(sortArray: components['parameters']['SortQuery']): SortOption[] {
  if (!sortArray) {
    return [];
  }

  const parsedOptions: SortOption[] = [];
  const fieldSet = new Set<string>();

  for (const option of sortArray) {
    const [field, order] = option.split(':');

    if (fieldSet.has(field)) {
      throw new SortQueryRepeatError(`Duplicate field in sort query: ${field}`);
    }
    fieldSet.add(field);

    const parsedField = sortFieldsMap.get(field) as SortableFields;

    parsedOptions.push({ field: parsedField, order: (order as 'asc' | 'desc' | undefined) ?? 'asc' });
  }

  return parsedOptions;
}

@injectable()
export class ConfigController {
  public constructor(@inject(ConfigManager) private readonly manager: ConfigManager) {}

  public getConfigs: TypedRequestHandler<'/config', 'get'> = async (req, res, next) => {
    try {
      const { sort, ...options } = req.query ?? {};
      const getConfigsResult = await this.manager.getConfigs({ ...options, sort: sortOptionParser(sort) });
      const formattedConfigs = getConfigsResult.configs.map(configMapper);
      return res.status(httpStatus.OK).json({ configs: formattedConfigs, total: getConfigsResult.totalCount });
    } catch (error) {
      if (error instanceof SortQueryRepeatError) {
        (error as HttpError).status = httpStatus.UNPROCESSABLE_ENTITY;
      }
      next(error);
    }
  };

  public getConfigByName: TypedRequestHandler<'/config/{name}', 'get'> = async (req, res, next) => {
    try {
      const config = await this.manager.getConfig(req.params.name, undefined, req.query?.shouldDereference);
      return res.status(httpStatus.OK).json(configMapper(config));
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        (error as HttpError).status = httpStatus.NOT_FOUND;
      }

      next(error);
    }
  };

  public getConfigByVersion: TypedRequestHandler<'/config/{name}/{version}', 'get'> = async (req, res, next) => {
    const version = req.params.version !== 'latest' ? req.params.version : undefined;

    try {
      const config = await this.manager.getConfig(req.params.name, version, req.query?.shouldDereference);
      return res.status(httpStatus.OK).json(configMapper(config));
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
