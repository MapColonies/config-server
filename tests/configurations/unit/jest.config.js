const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('../../../tsconfig.json');

/** @type {import('jest').Config} */
module.exports = {
  transform: {
    '^.+\\.ts$': ['@swc/jest'],
  },
  testMatch: ['<rootDir>/tests/unit/**/*.spec.ts'],
  coverageReporters: ['text', 'html'],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!*/node_modules/',
    '!/vendor/**',
    '!*/common/**',
    '!**/controllers/**',
    '!**/repositories/**',
    '!**/db/**',
    '!**/routes/**',
    '!<rootDir>/src/*',
    '!<rootDir>/src/configs/models/config.ts',
    '!**/errors.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  setupFilesAfterEnv: ['jest-openapi', '<rootDir>/tests/configurations/initJestOpenapi.setup.ts'],
  reporters: [
    'default',
    ['jest-html-reporters', { multipleReportsUnitePath: './reports', pageTitle: 'unit', publicPath: './reports', filename: 'unit.html' }],
  ],
  rootDir: '../../../.',
  setupFiles: ['<rootDir>/tests/configurations/jest.setup.ts'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: -10,
    },
  },
};
