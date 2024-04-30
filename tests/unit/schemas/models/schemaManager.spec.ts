import 'jest-openapi';
import jsLogger from '@map-colonies/js-logger';
import { SchemaManager } from '../../../../src/schemas/models/schemaManager';
import { SchemaNotFoundError, SchemaPathIsInvalidError } from '../../../../src/schemas/models/errors';

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
});
