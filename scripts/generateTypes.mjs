/* eslint-disable */
import fs from 'node:fs';
import { format, resolveConfig } from 'prettier';
import openapiTS, { astToString } from 'openapi-typescript';

const ESLINT_DISABLE = '/* eslint-disable */\n';

const ast = await openapiTS(new URL('../openapi3.yaml', import.meta.url));

const content = ESLINT_DISABLE + astToString(ast);

const prettierOptions = await resolveConfig('./src/index.ts');

const formattedContent = await format(content, { ...prettierOptions, parser: 'typescript' });

fs.writeFileSync('./src/openapiTypes.d.ts', formattedContent);

console.log('Types generated successfully');
