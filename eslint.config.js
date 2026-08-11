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
  },
  prettierConfig,
);
