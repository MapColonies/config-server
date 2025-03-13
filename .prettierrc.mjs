import mapColoniesPrettierConfig from '@map-colonies/prettier-config';

/** @type {import('prettier').Config} */
const prettierConfig = {
  plugins: ['prettier-plugin-embed', 'prettier-plugin-sql'],
};

/** @type {import('prettier-plugin-sql').SqlBaseOptions} */
const prettierPluginSqlConfig = {
  language: 'postgresql',
  keywordCase: 'upper',
};

const config = {
  ...mapColoniesPrettierConfig,
  ...prettierConfig,
  ...prettierPluginSqlConfig,
};

export default config;
