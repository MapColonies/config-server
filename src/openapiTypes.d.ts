/* eslint-disable */
export interface paths {
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
  '/config/{name}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** get a specific client connection for specific environment */
    get: operations['getConfigsByName'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/config/{name}/{version}': {
    parameters: {
      query?: {
        /** @description should the server bundle all refs into one config */
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
      };
      header?: never;
      path: {
        name: components['schemas']['configName'];
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
}
export type webhooks = Record<string, never>;
export interface components {
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
     *                 "url": "https://mapcolonies.com/common/boilerplate/v1"
     *               },
     *               {
     *                 "name": "v2",
     *                 "url": "https://mapcolonies.com/common/boilerplate/v2"
     *               },
     *               {
     *                 "name": "v3",
     *                 "url": "https://mapcolonies.com/common/boilerplate/v3"
     *               }
     *             ]
     *           },
     *           {
     *             "name": "db",
     *             "children": [
     *               {
     *                 "name": "v1",
     *                 "url": "https://mapcolonies.com/common/db/v1"
     *               }
     *             ]
     *           }
     *         ]
     *       }
     *     ] */
    schemaTree: (components['schemas']['schemaTreeItem'] | components['schemas']['schemaTreeDir'])[];
    schemaTreeItem: {
      name?: string;
      id?: components['schemas']['schemaId'];
    };
    schemaTreeDir: {
      children?: components['schemas']['schemaTree'];
      name?: string;
    };
    config: {
      configName: components['schemas']['configName'];
      schemaId: components['schemas']['schemaId'];
      version: components['schemas']['version'];
      /** @example {
       *       "host": "localhost",
       *       "port": 8080
       *     } */
      config: {
        [key: string]: unknown;
      };
      readonly createdAt: components['schemas']['createdAt'];
      readonly createdBy: components['schemas']['createdBy'];
      readonly isLatest?: boolean;
    };
    capabilities: {
      /** @description The version of the server */
      serverVersion: string;
      /** @description The version of the schemas package */
      schemasPackageVersion: string;
      /** @description a flag that indicates if the pubsub is enabled for config change notifications */
      pubSubEnabled: boolean;
    };
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
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
}
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
  getConfigsByName: {
    parameters: {
      query?: {
        /** @description should the server bundle all refs into one config */
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
      };
      header?: never;
      path: {
        name: components['schemas']['configName'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Array containing all the configs with the specific name */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['config'];
        };
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  getVersionedConfig: {
    parameters: {
      query?: {
        /** @description should the server bundle all refs into one config */
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
      };
      header?: never;
      path: {
        name: components['schemas']['configName'];
        version: 'latest' | components['schemas']['version'];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Object containing the config with the specific name and version or the latest version */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['config'];
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
}
