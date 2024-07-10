import Ajv, { AnySchemaObject, ErrorObject, ValidateFunction } from 'ajv';
import { injectable } from 'tsyringe';
import addFormats from 'ajv-formats';
import betterAjvErrors, { type IOutputError } from '@sidvind/better-ajv-errors';
import { SchemaManager } from '../../schemas/models/schemaManager';
import { ConfigReference, configReferenceSchema } from './configReference';

@injectable()
export class Validator {
  private readonly ajv: Ajv;
  private readonly ajvRefValidator: ValidateFunction;

  public constructor(private readonly schemaManager: SchemaManager) {
    this.ajv = addFormats(
      new Ajv({
        loadSchema: async (uri): Promise<AnySchemaObject> => {
          return this.schemaManager.getSchema(uri);
        },
        keywords: ['x-env-value'],
        useDefaults: true,
      }),
      ['date-time', 'time', 'date', 'email', 'hostname', 'ipv4', 'ipv6', 'uri', 'uuid', 'regex', 'uri-template']
    );

    this.ajvRefValidator = this.ajv.compile(configReferenceSchema);
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

  public validateRef(ref: unknown): ref is ConfigReference {
    return this.ajvRefValidator(ref);
  }
}
