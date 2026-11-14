module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
    jest: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    // `!= null` is an intentional null-or-undefined check and must stay one.
    eqeqeq: ['error', 'always', { null: 'ignore' }],
  },
  overrides: [
    {
      // Backend uses CommonJS
      files: ['backend/**/*.js'],
      parserOptions: { sourceType: 'script' },
      env: { node: true, browser: false },
    },
    {
      // Frontend + scan-pwa use ES Modules + React
      files: ['frontend/**/*.{js,jsx}', 'scan-pwa/**/*.{js,jsx}'],
      parserOptions: { sourceType: 'module' },
      env: { browser: true, node: false },
    },
    {
      // Build configs and Node test files run in Node, not the browser.
      files: ['**/vite.config.js', '**/*.test.js'],
      env: { node: true, browser: false },
    },
  ],
};
