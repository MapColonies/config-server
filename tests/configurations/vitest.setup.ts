import 'reflect-metadata';
/* eslint-disable */
import path from 'node:path';
import { expect } from 'vitest';
import jestOpenApi from 'jest-openapi';
import * as matchers from 'jest-extended';

expect.extend(matchers);

//@ts-ignore
globalThis.expect = expect;
require('jest-sorted');

jestOpenApi(path.join(process.cwd(), 'openapi3.yaml'));

//@ts-ignore
globalThis.expect = undefined as any; // Reset global expect to avoid conflicts with other test frameworks
