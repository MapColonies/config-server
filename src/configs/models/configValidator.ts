import Ajv, { AnySchemaObject, ErrorObject } from 'ajv';
import { injectable } from 'tsyringe';
import betterAjvErrors, { type IOutputError } from '@sidvind/better-ajv-errors';
import { SchemaManager } from '../../schemas/models/schemaManager';

@injectable()
export class Validator {
  private readonly ajv: Ajv;

  public constructor(private readonly schemaManager: SchemaManager) {
    this.ajv = new Ajv({
      loadSchema: async (uri): Promise<AnySchemaObject> => {
        return this.schemaManager.getSchema(uri);
      },
      useDefaults: true,
    });
  }

  public async isValid(schemaId: string, data: unknown): Promise<[boolean, IOutputError[]?]> {
    const validate = await this.ajv.compileAsync(await this.schemaManager.getSchema(schemaId));
    const valid = validate(data);

    if (!valid) {
      const schema = this.ajv.getSchema(schemaId)?.schema;
      const betterErrors = betterAjvErrors(schema as AnySchemaObject, data, validate.errors as ErrorObject[], { format: 'js' });
      return [false, betterErrors];
    }
    return [true];
  }
}
