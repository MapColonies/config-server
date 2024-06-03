module.exports = {
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  coverageReporters: ['text', 'html'],
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!*/node_modules/',
    '!/vendor/**',
    '!*/common/**',
    '!**/models/**',
    'src/**/*Manager*.ts',
    '!<rootDir>/src/*',
    '!**/db/runMigrations.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  rootDir: '../../../.',
  testMatch: ['<rootDir>/tests/integration/**/*.spec.ts'],
  setupFiles: ['<rootDir>/tests/configurations/jest.setup.ts'],
  setupFilesAfterEnv: ['jest-openapi', 'jest-extended/all', '<rootDir>/tests/configurations/initJestOpenapi.setup.ts'],
  reporters: [
    'default',
    [
      'jest-html-reporters',
      { multipleReportsUnitePath: './reports', pageTitle: 'integration', publicPath: './reports', filename: 'integration.html' },
    ],
  ],
  moduleDirectories: ['node_modules', 'src'],
  globalSetup: '<rootDir>/tests/configurations/integration/jest.globalSetup.ts',
  globalTeardown: '<rootDir>/tests/configurations/integration/jest.globalTeardown.ts',
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
