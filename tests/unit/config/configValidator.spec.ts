import betterAjvErrors from '@sidvind/better-ajv-errors';
import { Validator } from '../../../src/configs/models/configValidator';
import { SchemaManager } from '../../../src/schemas/models/schemaManager';

jest.mock('@sidvind/better-ajv-errors');

describe('Validator', () => {
  let validator: Validator;
  let schemaManager: SchemaManager;

  beforeEach(() => {
    schemaManager = {} as SchemaManager;
    validator = new Validator(schemaManager);
  });

  describe('isValid', () => {
    it('should return true when the data is valid', async () => {
      const schemaId = 'https://mapcolonies.com/test/v1';
      const data = { /* valid data object */ };
      const schema = { /* mock schema object */ };
      const validateMock = jest.fn().mockReturnValue(true);
      const getSchemaMock = jest.fn().mockResolvedValue(schema);
      const compileAsyncMock = jest.fn().mockResolvedValue(validateMock);

      schemaManager.getSchema = getSchemaMock;
      validator['ajv'].compileAsync = compileAsyncMock;

      const result = await validator.isValid(schemaId, data);

      expect(result).toEqual([true]);
    });

    it('should return false and error messages when the data is invalid', async () => {
      const schemaId = 'https://mapcolonies.com/test/v1';
      const data = { /* invalid data object */ };
      const schema = { /* mock schema object */ };
      const validateMock = jest.fn().mockReturnValue(false);
      const getSchemaMock = jest.fn().mockResolvedValue(schema);
      const compileAsyncMock = jest.fn().mockResolvedValue(validateMock);
      const getSchemaSchemaMock = jest.fn().mockReturnValue(schema);
      (betterAjvErrors as jest.Mock).mockReturnValue([{ message: 'Validation error' }]);

      schemaManager.getSchema = getSchemaMock;
      validator['ajv'].compileAsync = compileAsyncMock;
      validator['ajv'].getSchema = getSchemaSchemaMock;

      const result = await validator.isValid(schemaId, data);

      expect(result).toEqual([false, [{ message: 'Validation error' }]]);
    });
  });
});