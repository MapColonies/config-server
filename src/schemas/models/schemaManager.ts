import path from 'node:path';
import fs from 'node:fs';
import fsPromise from 'node:fs/promises';
import { type Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import type { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import { $RefParser } from '@apidevtools/json-schema-ref-parser';
import type { components } from '@openapi';
import { SERVICES } from '@common/constants';
import { setSpanAttributes, withSpan } from '@common/tracing';
import { enrichLogContext } from '@common/logger';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from './errors';
import type { SchemaIndexEntry, Dependencies, EnvVar, FullSchemaMetadata } from './types';

const schemasPackageResolvedPath = require.resolve('@map-colonies/schemas');
const schemasBasePath = schemasPackageResolvedPath.substring(0, schemasPackageResolvedPath.lastIndexOf('/'));

const refParser = new $RefParser();

type ArrayElement<ArrayType extends readonly unknown[]> = ArrayType extends readonly (infer ElementType)[] ? ElementType : never;

const SCHEMA_DOMAIN = 'https://mapcolonies.com/';
const SCHEMA_TRACING_CACHE_KEY = 'schema.cache';
const LAST_ARRAY_ELEMENT = -1;
const INTERNAL_REF_PREFIX_LENGTH = 2; // Length of '#/' prefix in internal references

export { schemasBasePath };
@injectable()
export class SchemaManager {
  private readonly schemaMap: Map<string, JSONSchema> = new Map();
  private readonly fullSchemaCache: Map<string, FullSchemaMetadata> = new Map();
  private schemaIndexCache: { schemas: SchemaIndexEntry[] } | null = null;

  public constructor(@inject(SERVICES.LOGGER) private readonly logger: Logger) {}

  // TODO: still undecided between input being id or path. will decide later
  @withSpan()
  public async getSchema(id: string, dereference = false): Promise<JSONSchema> {
    this.logger.debug({ msg: 'loading schema', schemaId: id });
    enrichLogContext({ schemaId: id }, true);

    const schemaPathPart = id.split(SCHEMA_DOMAIN)[1] as string; // we assume that the schema id is a valid url;
    // check for path traversal, if path starts with .. it is invalid
    if (path.normalize(schemaPathPart).startsWith('..')) {
      this.logger.error({ msg: 'schema path is invalid, path traversal' });
      throw new SchemaPathIsInvalidError('Schema path is invalid');
    }

    const schemaContent = await this.loadSchema(schemaPathPart, dereference);

    if (dereference) {
      return refParser.dereference(schemaContent, {
        dereference: { circular: false },
        resolve: {
          mapcolonies: {
            canRead: /^https:\/\/mapcolonies.com\/.*/,
            order: 1,
            read: async (file: { url: string; hash: string; extension: string }) => {
              const subPath = file.url.split(SCHEMA_DOMAIN)[1] as string;

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

  // New methods for schema index and full schema metadata

  /**
   * Returns searchable index of all schemas.
   * Frontend builds FlexSearch index client-side from this data.
   * With ~500 schemas (~100KB), client-side indexing is fast and simple.
   */
  @withSpan()
  public async getSchemaIndex(): Promise<{ schemas: SchemaIndexEntry[] }> {
    if (this.schemaIndexCache) {
      this.logger.debug('schema index loaded from cache');
      return this.schemaIndexCache;
    }

    this.logger.info({ msg: 'building schema index' });
    const schemas = await this.buildSchemaIndex();

    this.schemaIndexCache = { schemas };
    return this.schemaIndexCache;
  }

  @withSpan()
  public async getFullSchemaMetadata(schemaId: string): Promise<FullSchemaMetadata> {
    if (this.fullSchemaCache.has(schemaId)) {
      this.logger.debug('full schema metadata loaded from cache');
      return this.fullSchemaCache.get(schemaId) as FullSchemaMetadata;
    }

    this.logger.info({ msg: 'generating full schema metadata', schemaId });

    const rawContent = await this.getSchema(schemaId, false);
    const dereferencedContent = await this.getSchema(schemaId, true);

    const typeContent = await this.getTypeScriptForSchema(schemaId);
    const dependencies = this.extractDependencies(rawContent);
    const envVars = this.extractEnvVars(rawContent);

    // Parse metadata from schemaId
    const schemaPath = schemaId.replace(SCHEMA_DOMAIN, '');
    const pathParts = schemaPath.split('/');
    const category = pathParts[0] ?? 'unknown';
    const version = pathParts[pathParts.length - 1] ?? 'v1';

    const metadata: FullSchemaMetadata = {
      id: schemaId,
      name: (rawContent.title as string) || this.extractNameFromId(schemaId),
      path: schemaPath,
      version,
      category,
      description: rawContent.description,
      title: rawContent.title,
      rawContent: rawContent as unknown as Record<string, unknown>,
      dereferencedContent: dereferencedContent as unknown as Record<string, unknown>,
      typeContent,
      dependencies,
      envVars,
    };

    this.fullSchemaCache.set(schemaId, metadata);
    return metadata;
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
        id:
          SCHEMA_DOMAIN.slice(0, LAST_ARRAY_ELEMENT) +
          path.posix.join(dirPath.split(schemasBasePath)[1] as string, dirent.name.split('.')[0] as string),
      };
    });

    return Promise.all(resPromises);
  }

  @withSpan()
  private async buildSchemaIndex(): Promise<SchemaIndexEntry[]> {
    const schemas: SchemaIndexEntry[] = [];

    const collectSchemas = async (dirPath: string, relativePath = ''): Promise<void> => {
      const entries = await fsPromise.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        const entryRelativePath = relativePath ? path.posix.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          await collectSchemas(entryPath, entryRelativePath);
        } else if (entry.isFile() && entry.name.endsWith('.schema.json')) {
          try {
            const schemaContent = JSON.parse(await fsPromise.readFile(entryPath, { encoding: 'utf-8' })) as JSONSchema;
            const schemaId = schemaContent.$id as string;

            if (schemaId.startsWith(SCHEMA_DOMAIN)) {
              const schemaPath = schemaId.replace(SCHEMA_DOMAIN, '');
              const pathParts = schemaPath.split('/');
              const category = pathParts[0] ?? 'unknown';
              const version = pathParts[pathParts.length - 1] ?? 'v1';

              schemas.push({
                id: schemaId,
                name: (schemaContent.title as string) || this.extractNameFromId(schemaId),
                path: schemaPath,
                version,
                description: schemaContent.description,
                category,
                title: schemaContent.title,
              });
            }
          } catch (err) {
            this.logger.warn({ msg: 'Failed to parse schema file', path: entryPath, err });
          }
        }
      }
    };

    await collectSchemas(schemasBasePath);
    return schemas;
  }

  @withSpan()
  private async getTypeScriptForSchema(schemaId: string): Promise<string | null> {
    try {
      const schemaPath = schemaId.replace(SCHEMA_DOMAIN, '');
      const dtsPath = path.join(schemasBasePath, schemaPath + '.schema.d.ts');

      if (fs.existsSync(dtsPath)) {
        const fullContent = await fsPromise.readFile(dtsPath, { encoding: 'utf-8' });

        // Extract only the typeSymbol content
        const typeSymbolMatch = fullContent.match(/readonly \[typeSymbol\]: ([\s\S]*?);\s*readonly \$id:/);

        if (typeSymbolMatch?.[1] !== undefined && typeSymbolMatch[1] !== '') {
          return typeSymbolMatch[1].trim();
        }

        // Fallback: return full content if pattern not found
        this.logger.debug({ msg: 'Could not extract typeSymbol, returning full content', path: dtsPath });
        return fullContent;
      }

      this.logger.debug({ msg: 'TypeScript definition file not found', path: dtsPath });
      return null;
    } catch (err) {
      this.logger.warn({ msg: 'Failed to read TypeScript definition', schemaId, err });
      return null;
    }
  }

  @withSpan()
  private extractDependencies(schema: JSONSchema): Dependencies {
    const internal = new Set<string>();
    const external = new Set<string>();

    const traverse = (obj: unknown): void => {
      if (obj === undefined || typeof obj !== 'object') {
        return;
      }

      const objRecord = obj as Record<string, unknown>;

      if (objRecord.$ref !== undefined && typeof objRecord.$ref === 'string') {
        if (objRecord.$ref.startsWith('#/')) {
          internal.add(objRecord.$ref);
        } else if (objRecord.$ref.startsWith('https://')) {
          external.add(objRecord.$ref);
        }
      }

      // Recursively traverse all properties
      for (const key in objRecord) {
        if (Array.isArray(objRecord[key])) {
          (objRecord[key] as unknown[]).forEach(traverse);
        } else if (objRecord[key] !== null && typeof objRecord[key] === 'object') {
          traverse(objRecord[key]);
        }
      }
    };

    traverse(schema);

    return {
      internal: Array.from(internal),
      external: Array.from(external),
    };
  }

  @withSpan()
  private extractEnvVars(
    schema: JSONSchema,
    pathPrefix = '',
    requiredFields: Set<string> = new Set(),
    visitedRefs: Set<string> = new Set()
  ): EnvVar[] {
    const envVars: EnvVar[] = [];

    if (typeof schema !== 'object') return envVars;

    const schemaObj = schema as Record<string, unknown>;

    // Handle $ref - resolve and recurse
    if (schemaObj.$ref !== undefined && typeof schemaObj.$ref === 'string') {
      if (visitedRefs.has(schemaObj.$ref)) return envVars;
      visitedRefs.add(schemaObj.$ref);

      const resolvedSchema = this.resolveRef(schemaObj.$ref, schema);
      if (resolvedSchema) {
        const refVars = this.extractEnvVars(resolvedSchema, pathPrefix, requiredFields, visitedRefs);

        // Tag with refLink if external
        if (schemaObj.$ref.startsWith('https://')) {
          refVars.forEach((v) => (v.refLink = schemaObj.$ref as string));
        }

        envVars.push(...refVars);
      }
    }

    // Check current level for x-env-value
    if (schemaObj['x-env-value'] !== undefined) {
      const propertyName = pathPrefix.split('.').pop() ?? pathPrefix;
      envVars.push({
        envVariable: schemaObj['x-env-value'] as string,
        configPath: pathPrefix,
        format: (schemaObj['x-env-format'] as string) || (schemaObj.format as string),
        type: (schemaObj.type as string) || 'any',
        required: requiredFields.has(propertyName),
        description: schemaObj.description as string | undefined,
        default: schemaObj.default,
      });
    }

    // Handle allOf, oneOf, anyOf
    ['allOf', 'oneOf', 'anyOf'].forEach((key) => {
      if (Array.isArray(schemaObj[key])) {
        (schemaObj[key] as JSONSchema[]).forEach((subSchema) => {
          envVars.push(...this.extractEnvVars(subSchema, pathPrefix, requiredFields, visitedRefs));
        });
      }
    });

    // Recursively process properties
    if (schemaObj.properties !== undefined && typeof schemaObj.properties === 'object') {
      const required = new Set(Array.isArray(schemaObj.required) ? (schemaObj.required as string[]) : []);
      const properties = schemaObj.properties as Record<string, JSONSchema>;

      Object.entries(properties).forEach(([propName, propSchema]) => {
        const newPath = pathPrefix ? `${pathPrefix}.${propName}` : propName;
        envVars.push(...this.extractEnvVars(propSchema, newPath, required, visitedRefs));
      });
    }

    // Process definitions
    if (schemaObj.definitions !== undefined && typeof schemaObj.definitions === 'object') {
      const definitions = schemaObj.definitions as Record<string, JSONSchema>;
      Object.entries(definitions).forEach(([, defSchema]) => {
        envVars.push(...this.extractEnvVars(defSchema, pathPrefix, requiredFields, visitedRefs));
      });
    }

    return envVars;
  }

  @withSpan()
  private resolveRef(ref: string, rootSchema: JSONSchema): JSONSchema | null {
    if (ref.startsWith('#/')) {
      // Internal reference
      const pathSegments = ref.substring(INTERNAL_REF_PREFIX_LENGTH).split('/');
      let result: unknown = rootSchema;
      for (const segment of pathSegments) {
        if (result !== undefined && typeof result === 'object') {
          result = (result as Record<string, unknown>)[segment];
        } else {
          return null;
        }
      }
      return result as JSONSchema;
    } else if (ref.startsWith('https://')) {
      // External reference - load that schema synchronously from cache or file
      try {
        const schemaPath = ref.replace(SCHEMA_DOMAIN, '');
        const fullPath = path.join(schemasBasePath, schemaPath + '.schema.json');
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, { encoding: 'utf-8' });
          return JSON.parse(content) as JSONSchema;
        }
      } catch (err) {
        this.logger.warn({ msg: 'Failed to resolve external ref', ref, err });
      }
    }
    return null;
  }

  private extractNameFromId(schemaId: string): string {
    const pathPart = schemaId.replace(SCHEMA_DOMAIN, '');
    const parts = pathPart.split('/');
    // Convert path like "common/redis/v1" to "commonRedisV1"
    return parts.map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))).join('');
  }
}
