// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/target/**',
      '**/*.config.js',
      // Local tooling scratch space. Git-ignored via .remember/.gitignore, but ESLint doesn't
      // read nested .gitignore files, so it needs listing here too or `npm run lint` fails
      // locally on files that never reach CI.
      '.remember/**',
      // Dev-box browser smoke test (web/e2e/README.md): Node plus code evaluated inside the page, not CI-linted.
      'web/e2e/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // The OS's native dropdown looks out of place and stretches to the full screen height in a small
      // window. Use the Dropdown component (tauri-client/panels-ui/src/components/Dropdown.tsx).
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use the styled <Dropdown>, never a native <select>.',
        },
      ],
    },
  },
  {
    // Plain Node scripts (the live drills under infra/) run outside the TypeScript packages.
    files: ['infra/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  prettierConfig,
);
