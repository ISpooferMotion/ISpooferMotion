const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['dist/**', 'dist-main/**', 'build/**', 'node_modules/**', 'downloads/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-control-regex': 'off',
    },
  },
];
