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
    ignores: ['web/vite.config.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },

  // Type-checked by web/tsconfig.node.json (yarn typecheck). The ESLint project
  // service only discovers tsconfig.json, so lint it without type information.
  {
    files: ['web/vite.config.ts'],
    extends: [tseslint.configs.strict],
  },

  // shared/ runs in both the browser and Node, so it gets neither set of globals.
  {
    files: ['server/**', '**/*.config.*'],
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
              group: ['@app/server', '@app/server/*', '**/server', '**/server.js', '**/server/**'],
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
              group: ['**/routes', '**/routes.js', '**/routes/**'],
              message: 'Checks must stay independent of HTTP routes.',
            },
          ],
        },
      ],
    },
  },

  prettier,
);
