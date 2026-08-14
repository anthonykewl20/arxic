import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'test-fixtures/**',
      '**/dist/**',
      'coverage/**',
      'pnpm-lock.yaml',
      '.opencode/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[object.name=/^(describe|it|test)$/][property.name=/^(only|skip)$/]',
          message: 'Skipped/only tests are forbidden — ADR §13.1.',
        },
        {
          selector:
            "CallExpression[callee.type='Identifier'][callee.name=/^(xit|xdescribe|xtest)$/]",
          message: 'Skipped tests are forbidden — ADR §13.1.',
        },
      ],
    },
  },
);
