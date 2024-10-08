import { readFileSync } from 'node:fs';
import Ajv, { AnySchemaObject, ErrorObject, ValidateFunction } from 'ajv/dist/2019';
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
    const draft7MetaSchema = JSON.parse(
      readFileSync(require.resolve('ajv/dist/refs/json-schema-draft-07.json'), { encoding: 'utf-8' })
    ) as AnySchemaObject;
    this.ajv = addFormats(
      new Ajv({
        loadSchema: async (uri): Promise<AnySchemaObject> => {
          return this.schemaManager.getSchema(uri);
        },
        keywords: ['x-env-value'],
        useDefaults: true,
      })
    );

    this.ajv.addMetaSchema(draft7MetaSchema, 'http://json-schema.org/draft-07/schema#');

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
