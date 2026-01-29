import { describe, beforeEach, it, expect, test } from 'vitest';
import 'jest-openapi';
import { jsLogger } from '@map-colonies/js-logger';
import { SchemaManager } from '@src/schemas/models/schemaManager';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from '@src/schemas/models/errors';

describe('SchemaManager', () => {
  let schemaManager: SchemaManager;

  beforeEach(() => {
    schemaManager = new SchemaManager(jsLogger({ enabled: false }));
  });

  describe('#getSchema', () => {
    it('should load and return the schema content', async () => {
      const id = 'https://mapcolonies.com/common/boilerplate/v1';

      // Act
      const schema = await schemaManager.getSchema(id);

      // Assert
      expect(schema).toHaveProperty('$id', id);
    });

    test.each(['..', '../avi/..', 'avi/../../../avi'])(`the path %p is invalid`, async (path) => {
      // Arrange
      const id = `https://mapcolonies.com/${path}`;

      // Act & Assert
      await expect(schemaManager.getSchema(id)).rejects.toThrow(SchemaPathIsInvalidError);
    });

    it('should bundle and return the dereferenced schema content', async () => {
      // Arrange
      const id = 'https://mapcolonies.com/common/db/full/v1';

      // Act
      const schema = await schemaManager.getSchema(id, true);

      // Assert
      expect(schema).toHaveProperty('$id', id);
      expect(schema).toHaveProperty('allOf.[0].$id', 'https://mapcolonies.com/common/db/partial/v1');
    });

    it('should not mix between dereferenced and non-dereferenced schemas in cache (issue #26 regression)', async () => {
      const id = 'https://mapcolonies.com/common/db/full/v1';

      const nonDereferencedSchema = await schemaManager.getSchema(id, false);
      const dereferencedSchema = await schemaManager.getSchema(id, true);
      const nonDereferencedSchema2 = await schemaManager.getSchema(id, false);

      expect(nonDereferencedSchema).not.toStrictEqual(dereferencedSchema);
      expect(nonDereferencedSchema).toStrictEqual(nonDereferencedSchema2);
    });

    it('should throw an error if the schema is not found', async () => {
      // Arrange
      const id = 'https://mapcolonies.com/avi';

      // Act & Assert
      await expect(schemaManager.getSchema(id)).rejects.toThrow(SchemaNotFoundError);
    });
  });

  describe('#getSchemas', () => {
    it('should return the schema tree', async () => {
      // Act
      const schemaTree = await schemaManager.getSchemas();

      // Assert
      expect(schemaTree).toSatisfySchemaInApiSpec('schemaTree');
    });
  });

  describe('#getFullSchemaMetadata', () => {
    it('should handle schemas with null property values', async () => {
      // Arrange - This tests the fix for null check in extractDependencies
      const id = 'https://mapcolonies.com/common/boilerplate/v1';

      // Act
      const metadata = await schemaManager.getFullSchemaMetadata(id);

      // Assert - Should not throw TypeError when encountering null values
      expect(metadata).toHaveProperty('id', id);
      expect(metadata).toHaveProperty('dependencies');
      expect(metadata.dependencies).toHaveProperty('internal');
      expect(metadata.dependencies).toHaveProperty('external');
    });
  });
});
