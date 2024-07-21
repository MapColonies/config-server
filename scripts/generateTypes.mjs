/* eslint-disable */
import fs from 'node:fs';
import { format, resolveConfig } from 'prettier';
import openapiTS from 'openapi-typescript';

const ESLINT_DISABLE = '/* eslint-disable */\n';

const content = ESLINT_DISABLE + (await openapiTS(new URL('../openapi3.yaml', import.meta.url)));

const prettierOptions = await resolveConfig('./src/index.ts');

const formattedContent = await format(content, { ...prettierOptions, parser: 'typescript' });

fs.writeFileSync('./src/openapiTypes.d.ts', formattedContent);

console.log('Types generated successfully');
