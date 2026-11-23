import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**', '.yarn/**'] },

  js.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,

  // TypeScript with type information.
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  {
    files: ['server/**', 'shared/**', '**/*.config.*'],
    languageOptions: { globals: globals.node },
  },
  { files: ['web/src/**'], languageOptions: { globals: globals.browser } },

  // Attack-reproduction tests must never be skipped or focused (docs/01 K4).
  {
    files: ['**/*.test.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-disabled-tests': 'error',
      'vitest/no-focused-tests': 'error',
    },
  },

  // Layer boundaries (docs/01 §15.2).
  {
    files: ['web/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@app/server', '@app/server/*', '**/server/**'],
              message: 'web must not import server code. Share types via @app/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['server/src/webauthn/checks/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/routes/**'],
              message: 'Checks must stay independent of HTTP routes.',
            },
          ],
        },
      ],
    },
  },

  prettier,
);
