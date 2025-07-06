import { Type, type Static } from '@sinclair/typebox';

export const configReferenceSchema = Type.Object(
  {
    configName: Type.String(),
    version: Type.Union([Type.Integer({ minimum: 1 }), Type.Literal('latest')]),
    schemaId: Type.String(),
  },
  { additionalProperties: false }
);

export type ConfigReference = Static<typeof configReferenceSchema>;
