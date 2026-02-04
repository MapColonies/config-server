/* eslint-disable */
// This file was auto-generated. Do not edit manually.
// To update, run the error generation script again.

import type { TypedRequestHandlers as ImportedTypedRequestHandlers } from '@map-colonies/openapi-helpers/typedRequestHandler';
export type paths = {
  '/config': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** get configs based on filters */
    get: operations['getConfigs'];
    put?: never;
    /** Create a new config or a new version of an existing config */
    post: operations['upsertConfig'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/config/{name}/{version}': {
    parameters: {
      query: {
        /** @description should the server bundle all refs into one config */
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
        /** @description The id of the requested schema */
        schemaId: components['schemas']['schemaId'];
      };
      header?: {
        /** @description ETag value from a previous request to enable conditional GET requests */
        'If-None-Match'?: components['parameters']['IfNoneMatchHeader'];
      };
      path: {
        /** @description The name of the config */
        name: components['parameters']['ConfigNamePath'];
        version: 'latest' | components['schemas']['version'];
      };
      cookie?: never;
    };
    /** get a specific version of a config */
    get: operations['getVersionedConfig'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/config/{name}/{version}/full': {
    parameters: {
      query: {
        /** @description The id of the requested schema */
        schemaId: components['schemas']['schemaId'];
      };
      header?: never;
      path: {
        /** @description The name of the config */
        name: components['parameters']['ConfigNamePath'];
        version: 'latest' | components['schemas']['version'];
      };
      cookie?: never;
    };
    /**
     * Get comprehensive config metadata for inspector page
     * @description Returns all data needed for config inspector including raw/resolved/defaults config, dependencies, versions, env vars, and stats. Single endpoint replaces multiple API calls.
     */
    get: operations['getFullConfig'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/schema': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** returns the requested schema */
    get: operations['getSchema'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/schema/tree': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** return a tree representation of all the schemas */
    get: operations['getSchemasTree'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/schema/index': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get searchable index of all schemas
     * @description Returns metadata for all schemas. Frontend can build client-side search index from this data.
     */
    get: operations['getSchemasIndex'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/schema/full': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get comprehensive schema metadata */
    get: operations['getFullSchema'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/capabilities': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** get all capabilities about the server */
    get: operations['getCapabilities'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/locks': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Acquire a lock slot for a specific key */
    post: operations['acquireLock'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/locks/{key}/{callerId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Release a lock for a specific key and caller */
    delete: operations['releaseLock'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    error: {
      message: string;
    };
    configName: string;
    /** @example https://mapcolonies.com/common/db/v1 */
    schemaId: string;
    version: number;
    /** Format: date-time */
    createdAt: string;
    createdBy: string;
    /** @example [
     *       {
     *         "name": "common",
     *         "children": [
     *           {
     *             "name": "boilerplate",
     *             "children": [
     *               {
     *                 "name": "v1",
     *                 "id": "https://mapcolonies.com/common/boilerplate/v1"
     *               },
     *               {
     *                 "name": "v2",
     *                 "id": "https://mapcolonies.com/common/boilerplate/v2"
     *               },
     *               {
     *                 "name": "v3",
     *                 "id": "https://mapcolonies.com/common/boilerplate/v3"
     *               }
     *             ]
     *           },
     *           {
     *             "name": "db",
     *             "children": [
     *               {
     *                 "name": "v1",
     *                 "id": "https://mapcolonies.com/common/db/v1"
     *               }
     *             ]
     *           }
     *         ]
     *       }
     *     ] */
    schemaTree: (components['schemas']['schemaTreeItem'] | components['schemas']['schemaTreeDir'])[];
    schemaTreeItem: {
      name: string;
      id: components['schemas']['schemaId'];
    };
    schemaTreeDir: {
      children: components['schemas']['schemaTree'];
      name: string;
    };
    schemaReference: {
      /**
       * Format: uri
       * @description Schema ID
       */
      id: string;
      /** @description Schema name */
      name: string;
      /** @description Nested child schemas (recursive) */
      children?: components['schemas']['schemaReference'][];
      /** @description Nested parent schemas (recursive) */
      parents?: components['schemas']['schemaReference'][];
    };
    config: {
      configName: components['schemas']['configName'];
      schemaId: components['schemas']['schemaId'];
      version: components['schemas']['version'];
      readonly createdAt: components['schemas']['createdAt'];
      readonly createdBy: components['schemas']['createdBy'];
      readonly isLatest?: boolean;
      /** @description Merkle-tree hash of config body and dependencies for caching */
      readonly hash?: string;
      /** @example {
       *       "host": "localhost",
       *       "port": 8080
       *     } */
      config: {
        [key: string]: unknown;
      };
    };
    /** @description Comprehensive config metadata for inspector page */
    configFullMetadata: {
      configName: components['schemas']['configName'];
      schemaId: components['schemas']['schemaId'];
      version: components['schemas']['version'];
      readonly createdAt: components['schemas']['createdAt'];
      readonly createdBy: components['schemas']['createdBy'];
      readonly isLatest?: boolean;
      /** @description Merkle-tree hash of config body and dependencies for caching */
      readonly hash?: string;
      /** @description Config with $refs intact (as stored) - same as 'config' field from base schema */
      rawConfig: {
        [key: string]: unknown;
      };
      /** @description Config with all $refs dereferenced */
      resolvedConfig: {
        [key: string]: unknown;
      };
      /** @description Config with $refs resolved AND schema defaults applied (actual runtime values) */
      configWithDefaults: {
        [key: string]: unknown;
      };
      /** @description Lightweight schema metadata */
      schema: {
        /** Format: uri */
        id: string;
        name: string;
        version: string;
        category: string;
        description?: string;
      };
      /** @description Recursive dependency trees (max 2 levels deep) */
      dependencies: {
        /** @description Configs referenced by this config (nested tree, max 2 levels) */
        children: components['schemas']['configReference'][];
        /** @description Configs that reference this config (nested tree, max 2 levels) */
        parents: components['schemas']['configReference'][];
      };
      /** @description Version history for this config name */
      versions: {
        /** @description Total number of versions */
        total: number;
        all: components['schemas']['versionInfo'][];
      };
      /** @description Environment variables with current values */
      envVars: components['schemas']['envVarWithValue'][];
      stats: components['schemas']['configStats'];
    };
    /** @description Recursive tree node for config dependencies (similar to schemaReference) */
    configReference: {
      configName: components['schemas']['configName'];
      /** @description Single version number or array if multiple versions merged */
      version?: components['schemas']['version'] | components['schemas']['version'][];
      schemaId: components['schemas']['schemaId'];
      /** @description True if any of the versions is the latest */
      isLatest: boolean;
      /** @description Version details when multiple versions are merged */
      versions?: components['schemas']['versionInfo'][];
      /** @description Nested child configs (recursive, max 2 levels deep) */
      children?: components['schemas']['configReference'][];
      /** @description Nested parent configs (recursive, max 2 levels deep) */
      parents?: components['schemas']['configReference'][];
    };
    /** @description Metadata about a specific config version */
    versionInfo: {
      version: components['schemas']['version'];
      createdAt: components['schemas']['createdAt'];
      createdBy: components['schemas']['createdBy'];
      isLatest: boolean;
      /** @description Merkle-tree hash of this version */
      hash: string;
    };
    /** @description Environment variable with current actual value from resolved config */
    envVarWithValue: {
      /** @description Environment variable name (e.g., "DB_HOST") */
      envVariable: string;
      /** @description JSON path in config (e.g., "database.host") */
      configPath: string;
      /** @description Format hint from x-env-format or format field */
      format?: string;
      /** @description JSON schema type (e.g., "string", "integer") */
      type?: string;
      /** @description Whether this field is required by schema */
      required?: boolean;
      /** @description Schema description */
      description?: string;
      /** @description Default value from schema (any type) */
      default?: unknown;
      /**
       * Format: uri
       * @description External schema reference if this env var comes from a $ref
       */
      refLink?: string;
    } & {
      /** @description Actual value from resolved config with defaults applied */
      currentValue?: unknown;
      /**
       * @description Whether value comes from schema default or config override
       * @enum {string}
       */
      valueSource?: 'default' | 'config';
    };
    /** @description Computed statistics about config structure */
    configStats: {
      /**
       * @description Byte size of config JSON
       * @example 2048
       */
      configSize: number;
      /**
       * @description Total number of keys in config (recursive count)
       * @example 42
       */
      keyCount: number;
      /**
       * @description Number of $ref objects in config
       * @example 3
       */
      refCount: number;
      /**
       * @description Maximum nesting depth of config object
       * @example 5
       */
      depth: number;
    };
    capabilities: {
      /** @description The version of the server */
      serverVersion: string;
      /** @description The version of the schemas package */
      schemasPackageVersion: string;
      /** @description a flag that indicates if the pubsub is enabled for config change notifications */
      pubSubEnabled: boolean;
    };
    /** @description The unique ID of the instance holding the lock */
    callerId: string;
    /** @description An opaque identifier for the resource/group */
    key: string;
  };
  responses: {
    /** @description BadRequest */
    '400BadRequest': {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description Not Found - If client does not exist */
    '404NotFound': {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description conflict */
    '409Conflict': {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description Unprocessable Entity */
    '422UnprocessableEntity': {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description Internal Server Error */
    '500InternalServerError': {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['error'];
      };
    };
  };
  parameters: {
    /** @description The name of the config */
    ConfigNamePath: components['schemas']['configName'];
    /** @description Filters objects based on the exact value of the configName property. */
    ConfigNameQuery: components['schemas']['configName'];
    /** @description Filters objects where the schemaId property exactly matches the specified URL. */
    SchemaIdQuery: components['schemas']['schemaId'];
    /** @description Filters objects where the version property exactly matches the specified version string. */
    VersionQuery: components['schemas']['version'] | 'latest';
    /** @description Filters objects where the createdAt property is greater than the specified date-time value (format: ISO 8601). */
    CreatedAtGreaterThanQuery: components['schemas']['createdAt'];
    /** @description Filters objects where the createdAt property is less than the specified date-time value (format: ISO 8601). */
    CreatedAtLessThanQuery: components['schemas']['createdAt'];
    /** @description Filters objects based on the exact value of the createdBy property. */
    CreatedByQuery: components['schemas']['createdBy'];
    /** @description Specifies the number of items to skip before starting to return results. */
    OffsetQuery: number;
    /** @description Specifies the maximum number of items to return. */
    LimitQuery: number;
    /** @description Search term for full-text search across relevant properties (implementation specific). */
    FullTextQuery: string;
    /**
     * @description Sorts the results based on the value of one or more properties.
     *      The value is a comma-separated list of property names and sort order.
     *      properties should be separated by a colon and sort order should be either asc or desc. For example: configName:asc,schemaId:desc
     *      The default sort order is ascending. If the sort order is not specified, the default sort order is used. Each property is only allowed to appear once in the list.
     * @example [
     *       "config-name:asc",
     *       "schema-id:desc",
     *       "version"
     *     ]
     */
    SortQuery: string[];
    /** @description should the server bundle all refs into one config */
    ShouldDereferenceConfigQuery: boolean;
    /** @description ETag value from a previous request to enable conditional GET requests */
    IfNoneMatchHeader: string;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  getConfigs: {
    parameters: {
      query?: {
        /** @description Search term for full-text search across relevant properties (implementation specific). */
        q?: components['parameters']['FullTextQuery'];
        /** @description Filters objects based on the exact value of the configName property. */
        config_name?: components['parameters']['ConfigNameQuery'];
        /** @description Filters objects where the schemaId property exactly matches the specified URL. */
        schema_id?: components['parameters']['SchemaIdQuery'];
        /** @description Filters objects where the version property exactly matches the specified version string. */
        version?: components['parameters']['VersionQuery'];
        /** @description Filters objects where the createdAt property is greater than the specified date-time value (format: ISO 8601). */
        created_at_gt?: components['parameters']['CreatedAtGreaterThanQuery'];
        /** @description Filters objects where the createdAt property is less than the specified date-time value (format: ISO 8601). */
        created_at_lt?: components['parameters']['CreatedAtLessThanQuery'];
        /** @description Filters objects based on the exact value of the createdBy property. */
        created_by?: components['parameters']['CreatedByQuery'];
        /** @description Specifies the number of items to skip before starting to return results. */
        offset?: components['parameters']['OffsetQuery'];
        /** @description Specifies the maximum number of items to return. */
        limit?: components['parameters']['LimitQuery'];
        /**
         * @description Sorts the results based on the value of one or more properties.
         *      The value is a comma-separated list of property names and sort order.
         *      properties should be separated by a colon and sort order should be either asc or desc. For example: configName:asc,schemaId:desc
         *      The default sort order is ascending. If the sort order is not specified, the default sort order is used. Each property is only allowed to appear once in the list.
         * @example [
         *       "config-name:asc",
         *       "schema-id:desc",
         *       "version"
         *     ]
         */
        sort?: components['parameters']['SortQuery'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Array containing all the configs returned based on the filters */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            configs?: components['schemas']['config'][];
            total?: number;
          };
        };
      };
      400: components['responses']['400BadRequest'];
      422: components['responses']['422UnprocessableEntity'];
      500: components['responses']['500InternalServerError'];
    };
  };
  upsertConfig: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** @description If no version is provided and no version with the same name exists, a new config will be created. If a version is provided, a new version of an existing config will be created. The version provided should match the latest version of the existing config. */
    requestBody: {
      content: {
        'application/json': components['schemas']['config'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: components['responses']['400BadRequest'];
      409: components['responses']['409Conflict'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getVersionedConfig: {
    parameters: {
      query: {
        /** @description should the server bundle all refs into one config */
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
        /** @description The id of the requested schema */
        schemaId: components['schemas']['schemaId'];
      };
      header?: {
        /** @description ETag value from a previous request to enable conditional GET requests */
        'If-None-Match'?: components['parameters']['IfNoneMatchHeader'];
      };
      path: {
        /** @description The name of the config */
        name: components['parameters']['ConfigNamePath'];
        version: 'latest' | components['schemas']['version'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Object containing the config with the specific name and version or the latest version */
      200: {
        headers: {
          /** @description Entity tag for caching and conditional requests */
          ETag?: string;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['config'];
        };
      };
      /** @description Not Modified - Config has not changed since the ETag provided in If-None-Match header */
      304: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getFullConfig: {
    parameters: {
      query: {
        /** @description The id of the requested schema */
        schemaId: components['schemas']['schemaId'];
      };
      header?: never;
      path: {
        /** @description The name of the config */
        name: components['parameters']['ConfigNamePath'];
        version: 'latest' | components['schemas']['version'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['configFullMetadata'];
        };
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getSchema: {
    parameters: {
      query: {
        /** @description The id of the requested schema */
        id: components['schemas']['schemaId'];
        /** @description should the server bundle all refs into one schema */
        shouldDereference?: boolean;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': Record<string, never>;
        };
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getSchemasTree: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['schemaTree'];
        };
      };
      400: components['responses']['400BadRequest'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getSchemasIndex: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            schemas: {
              /** Format: uri */
              id: string;
              name: string;
              path: string;
              version: string;
              description?: string;
              category: string;
              title?: string;
            }[];
          };
        };
      };
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getFullSchema: {
    parameters: {
      query: {
        /** @description The id of the requested schema */
        id: components['schemas']['schemaId'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uri */
            id: string;
            name: string;
            path: string;
            version: string;
            category: string;
            description?: string;
            title?: string;
            /** @description Raw JSON Schema */
            rawContent: {
              [key: string]: unknown;
            };
            /** @description Schema with all $refs resolved */
            dereferencedContent: {
              [key: string]: unknown;
            };
            /** @description TypeScript type definitions */
            typeContent?: string | null;
            dependencies: {
              /** @description All parent schemas that reference this schema (nested tree structure) */
              parents: components['schemas']['schemaReference'][];
              /** @description All child schemas referenced by this schema (nested tree structure) */
              children: components['schemas']['schemaReference'][];
            };
            envVars: {
              /** @description Environment variable name */
              envVariable: string;
              /** @description JSON path to the property (e.g., "db.host") */
              configPath: string;
              /** @description Format hint (from x-env-format or format field) */
              format?: string;
              /** @description JSON schema type (e.g., "string", "integer") */
              type?: string;
              /** @description Whether this field is required */
              required?: boolean;
              /** @description Schema description */
              description?: string;
              /** @description Default value (any type) */
              default?: unknown;
              /**
               * Format: uri
               * @description External schema reference if this env var comes from a $ref
               */
              refLink?: string;
            }[];
          };
        };
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getCapabilities: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['capabilities'];
        };
      };
      400: components['responses']['400BadRequest'];
      500: components['responses']['500InternalServerError'];
    };
  };
  acquireLock: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          key: components['schemas']['key'];
          callerId: components['schemas']['callerId'];
          /** @description Time to live in seconds */
          ttl: number;
          /** @description Maximum number of concurrent locks for this key */
          limit: number;
        };
      };
    };
    responses: {
      /** @description Lock acquired or renewed successfully */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: components['responses']['400BadRequest'];
      /** @description Locked - Concurrency limit reached */
      423: {
        headers: {
          /** @description Number of seconds to wait before retrying */
          'Retry-After'?: number;
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['error'];
        };
      };
      500: components['responses']['500InternalServerError'];
    };
  };
  releaseLock: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        /** @description The lock key */
        key: components['schemas']['key'];
        /** @description The caller ID */
        callerId: components['schemas']['callerId'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Lock released successfully */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: components['responses']['400BadRequest'];
      500: components['responses']['500InternalServerError'];
    };
  };
}
export type TypedRequestHandlers = ImportedTypedRequestHandlers<paths, operations>;
