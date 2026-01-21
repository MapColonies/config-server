import tsBaseConfig from '@map-colonies/eslint-config/ts-base';
import jestConfig from '@map-colonies/eslint-config/jest';
import { defineConfig } from 'eslint/config';

export default defineConfig(tsBaseConfig, { ignores: ['drizzle.config.ts', 'vitest.config.mts'] });
