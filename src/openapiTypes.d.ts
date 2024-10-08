/* eslint-disable */
/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */

export interface paths {
  '/config': {
    /** get configs based on filters */
    get: operations['getConfigs'];
    /** Create a new config or a new version of an existing config */
    post: operations['upsertConfig'];
  };
  '/config/{name}': {
    /** get a specific client connection for specific environment */
    get: operations['getConfigsByName'];
  };
  '/config/{name}/{version}': {
    /** get a specific version of a config */
    get: operations['getVersionedConfig'];
    parameters: {
      query?: {
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
      };
      path: {
        name: components['schemas']['configName'];
        version: 'latest' | components['schemas']['version'];
      };
    };
  };
  '/schema': {
    /** returns the requested schema */
    get: operations['getSchema'];
  };
  '/schema/tree': {
    /** return a tree representation of all the schemas */
    get: operations['getSchemasTree'];
  };
  '/capabilities': {
    /** get all capabilities about the server */
    get: operations['getCapabilities'];
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
    /**
     * @example [
     *   {
     *     "name": "common",
     *     "children": [
     *       {
     *         "name": "boilerplate",
     *         "children": [
     *           {
     *             "name": "v1",
     *             "url": "https://mapcolonies.com/common/boilerplate/v1"
     *           },
     *           {
     *             "name": "v2",
     *             "url": "https://mapcolonies.com/common/boilerplate/v2"
     *           },
     *           {
     *             "name": "v3",
     *             "url": "https://mapcolonies.com/common/boilerplate/v3"
     *           }
     *         ]
     *       },
     *       {
     *         "name": "db",
     *         "children": [
     *           {
     *             "name": "v1",
     *             "url": "https://mapcolonies.com/common/db/v1"
     *           }
     *         ]
     *       }
     *     ]
     *   }
     * ]
     */
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
      /**
       * @example {
       *   "host": "localhost",
       *   "port": 8080
       * }
       */
      config: {
        [key: string]: unknown;
      };
      createdAt: components['schemas']['createdAt'];
      createdBy: components['schemas']['createdBy'];
      isLatest?: boolean;
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
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description Not Found - If client does not exist */
    '404NotFound': {
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description conflict */
    '409Conflict': {
      content: {
        'application/json': components['schemas']['error'];
      };
    };
    /** @description Internal Server Error */
    '500InternalServerError': {
      content: {
        'application/json': components['schemas']['error'];
      };
    };
  };
  parameters: {
    /** @description Filters objects based on the exact value of the configName property. */
    ConfigNameQuery?: components['schemas']['configName'];
    /** @description Filters objects where the schemaId property exactly matches the specified URL. */
    SchemaIdQuery?: components['schemas']['schemaId'];
    /** @description Filters objects where the version property exactly matches the specified version string. */
    VersionQuery?: components['schemas']['version'] | 'latest';
    /** @description Filters objects where the createdAt property is greater than the specified date-time value (format: ISO 8601). */
    CreatedAtGreaterThanQuery?: components['schemas']['createdAt'];
    /** @description Filters objects where the createdAt property is less than the specified date-time value (format: ISO 8601). */
    CreatedAtLessThanQuery?: components['schemas']['createdAt'];
    /** @description Filters objects based on the exact value of the createdBy property. */
    CreatedByQuery?: components['schemas']['createdBy'];
    /** @description Specifies the number of items to skip before starting to return results. */
    OffsetQuery?: number;
    /** @description Specifies the maximum number of items to return. */
    LimitQuery?: number;
    /** @description Search term for full-text search across relevant properties (implementation specific). */
    FullTextQuery?: string;
    /** @description Sorts the results based on the value of one or more properties. The value is a comma-separated list of property names with an optional "-" prefix to indicate descending order. */
    SortQuery?: string[];
    /** @description should the server bundle all refs into one config */
    ShouldDereferenceConfigQuery?: boolean;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type $defs = Record<string, never>;

export type external = Record<string, never>;

export interface operations {
  /** get configs based on filters */
  getConfigs: {
    parameters: {
      query?: {
        q?: components['parameters']['FullTextQuery'];
        config_name?: components['parameters']['ConfigNameQuery'];
        schema_id?: components['parameters']['SchemaIdQuery'];
        version?: components['parameters']['VersionQuery'];
        created_at_gt?: components['parameters']['CreatedAtGreaterThanQuery'];
        created_at_lt?: components['parameters']['CreatedAtLessThanQuery'];
        created_by?: components['parameters']['CreatedByQuery'];
        offset?: components['parameters']['OffsetQuery'];
        limit?: components['parameters']['LimitQuery'];
        sort?: components['parameters']['SortQuery'];
      };
    };
    responses: {
      /** @description Array containing all the configs returned based on the filters */
      200: {
        content: {
          'application/json': {
            configs?: components['schemas']['config'][];
            total?: number;
          };
        };
      };
      400: components['responses']['400BadRequest'];
      500: components['responses']['500InternalServerError'];
    };
  };
  /** Create a new config or a new version of an existing config */
  upsertConfig: {
    /** @description If no version is provided and no version with the same name exists, a new config will be created. If a version is provided, a new version of an existing config will be created. The version provided should match the latest version of the existing config. */
    requestBody: {
      content: {
        'application/json': components['schemas']['config'];
      };
    };
    responses: {
      /** @description Created */
      201: {
        content: never;
      };
      400: components['responses']['400BadRequest'];
      409: components['responses']['409Conflict'];
      500: components['responses']['500InternalServerError'];
    };
  };
  /** get a specific client connection for specific environment */
  getConfigsByName: {
    parameters: {
      query?: {
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
      };
      path: {
        name: components['schemas']['configName'];
      };
    };
    responses: {
      /** @description Array containing all the configs with the specific name */
      200: {
        content: {
          'application/json': components['schemas']['config'];
        };
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  /** get a specific version of a config */
  getVersionedConfig: {
    parameters: {
      query?: {
        shouldDereference?: components['parameters']['ShouldDereferenceConfigQuery'];
      };
      path: {
        name: components['schemas']['configName'];
        version: 'latest' | components['schemas']['version'];
      };
    };
    responses: {
      /** @description Object containing the config with the specific name and version or the latest version */
      200: {
        content: {
          'application/json': components['schemas']['config'];
        };
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  /** returns the requested schema */
  getSchema: {
    parameters: {
      query: {
        /** @description The id of the requested schema */
        id: components['schemas']['schemaId'];
        /** @description should the server bundle all refs into one schema */
        shouldDereference?: boolean;
      };
    };
    responses: {
      /** @description OK */
      200: {
        content: {
          'application/json': Record<string, never>;
        };
      };
      400: components['responses']['400BadRequest'];
      404: components['responses']['404NotFound'];
      500: components['responses']['500InternalServerError'];
    };
  };
  /** return a tree representation of all the schemas */
  getSchemasTree: {
    responses: {
      /** @description OK */
      200: {
        content: {
          'application/json': components['schemas']['schemaTree'];
        };
      };
      400: components['responses']['400BadRequest'];
      500: components['responses']['500InternalServerError'];
    };
  };
  /** get all capabilities about the server */
  getCapabilities: {
    responses: {
      /** @description OK */
      200: {
        content: {
          'application/json': components['schemas']['capabilities'];
        };
      };
      400: components['responses']['400BadRequest'];
      500: components['responses']['500InternalServerError'];
    };
  };
}
