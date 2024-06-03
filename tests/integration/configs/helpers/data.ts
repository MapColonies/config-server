import { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import { ConfigRef, NewConfig } from '../../../../src/configs/models/config';

export const simpleSchema: JSONSchema = {
  type: 'object',
  $id: 'https://mapcolonies.com/simpleSchema/v1',
  additionalProperties: false,
  properties: {
    name: {
      type: 'string',
    },
    age: {
      type: 'number',
    },
  },
};

export const schemaWithRef: JSONSchema = {
  type: 'object',
  $id: 'https://mapcolonies.com/schemaWithRef/v1',
  additionalProperties: false,
  properties: {
    manager: {
      $ref: 'https://mapcolonies.com/simpleSchema/v1',
    },
    role: {
      type: 'string',
      default: 'manager',
    },
  },
};

export const primitiveSchema: JSONSchema = {
  type: 'string',
  $id: 'https://mapcolonies.com/primitiveSchema/v1',
};

export const primitiveRefSchema: JSONSchema = {
  type: 'object',
  $id: 'https://mapcolonies.com/primitiveRefSchema/v1',
  properties: {
    primitive: {
      $ref: 'https://mapcolonies.com/primitiveSchema/v1',
    },
  },
};

export const configsMockData: NewConfig[] = [
  {
    configName: 'config1',
    schemaId: 'https://mapcolonies.com/simpleSchema/v1',
    version: 1,
    config: {
      name: 'name1',
      age: 1,
    },
    createdBy: 'user1',
  },
  {
    configName: 'config1',
    schemaId: 'https://mapcolonies.com/simpleSchema/v1',
    version: 2,
    config: {
      name: 'name2',
      age: 2,
    },
    createdBy: 'user2',
  },
  {
    configName: 'config2',
    schemaId: 'https://mapcolonies.com/simpleSchema/v1',
    version: 1,
    config: {
      name: 'name3',
      age: 3,
    },
    createdAt: new Date('2001-01-01'),
    createdBy: 'user3',
  },
  {
    configName: 'config3',
    schemaId: 'https://mapcolonies.com/simpleSchema/v1',
    version: 1,
    config: {
      name: 'name4',
      age: 5,
    },
    createdAt: new Date('2001-01-01'),
    createdBy: 'user3',
  },
  {
    configName: 'config3',
    schemaId: 'https://mapcolonies.com/simpleSchema/v1',
    version: 2,
    config: {
      name: 'name5',
      age: 6,
    },
    createdAt: new Date('2001-01-01'),
    createdBy: 'user3',
  },
  {
    configName: 'configRef1',
    createdBy: 'user4',
    schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
    version: 1,
    config: {
      manager: {
        name: 'name1',
        age: 1,
      },
    },
  },
  {
    configName: 'configRef2',
    createdBy: 'user5',
    schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
    version: 1,
    config: {
      manager: {
        $ref: { configName: 'config3', version: 1 },
      },
    },
  },
  {
    configName: 'configRef3',
    createdBy: 'user5',
    schemaId: 'https://mapcolonies.com/schemaWithRef/v1',
    version: 1,
    config: {
      manager: {
        $ref: { configName: 'config3', version: 'latest' },
      },
    },
  },
  {
    configName: 'primitiveConfig',
    createdBy: 'user5',
    schemaId: 'https://mapcolonies.com/primitiveSchema/v1',
    version: 1,
    config: 'primitive' as unknown as Record<string, unknown>,
  },
];

export const refs: ConfigRef[] = [
  {
    configName: 'configRef2',
    version: 1,
    refConfigName: 'config3',
    refVersion: 1,
  },
  {
    configName: 'configRef3',
    version: 1,
    refConfigName: 'config3',
    refVersion: null,
  },
];
