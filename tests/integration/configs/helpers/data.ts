import { JSONSchema } from '@apidevtools/json-schema-ref-parser';
import { NewConfig } from '../../../../src/configs/models/config';

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
];
