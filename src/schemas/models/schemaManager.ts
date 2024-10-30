import path from 'node:path';
import fs from 'node:fs';
import fsPromise from 'node:fs/promises';
import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { JSONSchema, $RefParser } from '@apidevtools/json-schema-ref-parser';
import { SERVICES } from '../../common/constants';
import { components } from '../../openapiTypes';
import { setSpanAttributes, withSpan } from '../../common/tracing';
import { enrichLogContext } from '../../common/logger';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from './errors';

const schemasPackageResolvedPath = require.resolve('@map-colonies/schemas');
const schemasBasePath = schemasPackageResolvedPath.substring(0, schemasPackageResolvedPath.lastIndexOf('/'));

const refParser = new $RefParser();

type ArrayElement<ArrayType extends readonly unknown[]> = ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

const SCHEMA_DOMAIN = 'https://mapcolonies.com/';
const SCHEMA_TRACING_CACHE_KEY = 'schema.cache';
const LAST_ARRAY_ELEMENT = -1;

@injectable()
export class SchemaManager {
  private readonly schemaMap: Map<string, JSONSchema> = new Map();
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  // TODO: still undecided between input being id or path. will decide later
  @withSpan()
  public async getSchema(id: string, dereference = false): Promise<JSONSchema> {
    this.logger.info({ msg: 'loading schema', schemaId: id });
    enrichLogContext({ schemaId: id }, true);

    // check for path traversal, if path starts with .. it is invalid
    if (path.normalize(id.split(SCHEMA_DOMAIN)[1]).startsWith('..')) {
      this.logger.error({ msg: 'schema path is invalid, path traversal' });
      throw new SchemaPathIsInvalidError('Schema path is invalid');
    }

    const schemaContent = await this.loadSchema(id.split(SCHEMA_DOMAIN)[1], dereference);

    if (dereference) {
      return refParser.dereference(schemaContent, {
        dereference: { circular: false },
        resolve: {
          mapcolonies: {
            canRead: /^https:\/\/mapcolonies.com\/.*/,
            order: 1,
            read: async (file: { url: string; hash: string; extension: string }) => {
              const subPath = file.url.split(SCHEMA_DOMAIN)[1];

              return this.loadSchema(subPath, dereference);
            },
          },
        },
      });
    }

    return schemaContent;
  }

  @withSpan()
  public async getSchemas(): Promise<components['schemas']['schemaTree']> {
    this.logger.info({ msg: 'generating schema tree' });
    return this.createSchemaTreeNode(schemasBasePath);
  }

  @withSpan()
  private async createSchemaTreeNode(dirPath: string): Promise<components['schemas']['schemaTree']> {
    const dir = (await fsPromise.readdir(dirPath, { withFileTypes: true })).filter(
      (dirent) => dirent.isDirectory() || (dirent.isFile() && dirent.name.endsWith('.schema.json'))
    );

    const resPromises = dir.map<Promise<ArrayElement<components['schemas']['schemaTree']>>>(async (dirent) => {
      if (dirent.isDirectory()) {
        return { name: dirent.name, children: await this.createSchemaTreeNode(path.join(dirPath, dirent.name)) };
      }

      return {
        name: dirent.name,
        id: SCHEMA_DOMAIN.slice(0, LAST_ARRAY_ELEMENT) + path.posix.join(dirPath.split(schemasBasePath)[1], dirent.name.split('.')[0]),
      };
    });

    return Promise.all(resPromises);
  }

  @withSpan()
  private async loadSchema(relativePath: string, isDereferenced = false): Promise<JSONSchema> {
    const cacheKey = String(isDereferenced) + ':' + relativePath;

    if (this.schemaMap.has(cacheKey)) {
      this.logger.debug('schema loaded from cache');
      setSpanAttributes({ [SCHEMA_TRACING_CACHE_KEY]: 'hit' });
      return this.schemaMap.get(cacheKey) as JSONSchema;
    }
    setSpanAttributes({ [SCHEMA_TRACING_CACHE_KEY]: 'miss' });

    const fullPath = path.join(schemasBasePath, relativePath + '.schema.json');

    if (!fs.existsSync(fullPath)) {
      this.logger.warn({ msg: 'schema not found', path: fullPath });
      throw new SchemaNotFoundError();
    }

    const schemaContent = JSON.parse(await fsPromise.readFile(fullPath, { encoding: 'utf-8' })) as JSONSchema;
    if (!isDereferenced) {
      this.schemaMap.set(cacheKey, schemaContent);
    }
    return schemaContent;
  }
}
