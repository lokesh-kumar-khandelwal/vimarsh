import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        process: 'readonly',
        performance: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        Worker: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        DOMException: 'readonly',
        MessageEvent: 'readonly',
        ErrorEvent: 'readonly',
        Record: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'off', // TypeScript compiler handles type and symbol resolution
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'bun.lock'],
  },
];
