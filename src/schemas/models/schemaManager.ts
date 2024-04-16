import path from 'node:path';
import fs from 'node:fs';
import fsPromise from 'node:fs/promises';
import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { JSONSchema, $RefParser } from '@apidevtools/json-schema-ref-parser';
import { SERVICES } from '../../common/constants';
import { components } from '../../schema';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from './errors';

const schemasBasePath = require.resolve('@map-colonies/schemas').substring(0, require.resolve('@map-colonies/schemas').lastIndexOf('/'));

const refParser = new $RefParser();

type ArrayElement<ArrayType extends readonly unknown[]> = ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

@injectable()
export class SchemaManager {
  private readonly schemaMap: Map<string, JSONSchema> = new Map();
  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  // still undecided between input being id or path. will decide later
  public async getSchema(id: string, dereference = false): Promise<JSONSchema> {
    this.logger.info({ msg: 'loading schema', schemaId: id });

    // check for path traversal, if path starts with .. it is invalid
    if (path.normalize(id.split('https://mapcolonies.com/')[1]).startsWith('..')) {
      this.logger.error({ msg: 'schema path is invalid, path traversal' });
      throw new SchemaPathIsInvalidError('Schema path is invalid');
    }

    const schemaContent = await this.loadSchema(id.split('https://mapcolonies.com/')[1]);

    if (dereference) {
      return refParser.bundle(schemaContent, {
        dereference: { circular: false },
        resolve: {
          mapcolonies: {
            canRead: /^https:\/\/mapcolonies.com\/.*/,
            order: 1,
            read: async (file: { url: string; hash: string; extension: string }) => {
              const subPath = file.url.split('https://mapcolonies.com/')[1];

              return this.loadSchema(subPath);
            },
          },
        },
      });
    }

    return schemaContent;
  }

  public async getSchemas(): Promise<components['schemas']['schemaTree']> {
    this.logger.info({ msg: 'generating schema tree' });
    return this.createSchemaTreeNode(schemasBasePath);
  }

  private async createSchemaTreeNode(dirPath: string): Promise<components['schemas']['schemaTree']> {
    const dir = (await fsPromise.readdir(dirPath, { withFileTypes: true })).filter(
      (dirent) => dirent.isDirectory() || (dirent.isFile() && dirent.name.endsWith('.schema.json'))
    );

    const resPromises = dir.map<Promise<ArrayElement<components['schemas']['schemaTree']>>>(async (dirent) => {
      if (dirent.isDirectory()) {
        return { name: dirent.name, children: await this.createSchemaTreeNode(path.join(dirPath, dirent.name)) };
      }
      return { name: dirent.name, id: 'https://mapcolonies.com' + dirPath.split(schemasBasePath)[1] + '/' + dirent.name.split('.')[0] };
    });

    return Promise.all(resPromises);
  }

  private async loadSchema(relativePath: string): Promise<JSONSchema> {
    if (this.schemaMap.has(relativePath)) {
      return this.schemaMap.get(relativePath) as JSONSchema;
    }

    const fullPath = path.join(schemasBasePath, relativePath + '.schema.json');

    if (!fs.existsSync(fullPath)) {
      this.logger.error({ msg: 'schema not found', path: fullPath });
      throw new SchemaNotFoundError();
    }

    const schemaContent = JSON.parse(await fsPromise.readFile(fullPath, { encoding: 'utf-8' })) as JSONSchema;
    this.schemaMap.set(relativePath, schemaContent);
    return schemaContent;
  }
}
