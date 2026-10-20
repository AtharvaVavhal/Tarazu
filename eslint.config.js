import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Layering and float rules implement 04 §3. Lint-rule behaviour is itself tested in tests/lint.

const FLOAT_SYNTAX = [
  {
    selector: "CallExpression[callee.name='parseFloat']",
    message: 'No parseFloat in money paths (INV-ACC-01).',
  },
  {
    selector: "CallExpression[callee.name='parseInt']",
    message: 'No parseInt on money (INV-ACC-01).',
  },
  {
    selector: "CallExpression[callee.name='Number']",
    message: 'No Number(...) of paise outside domain/money and ui/charts (04 §3.4).',
  },
  {
    selector:
      "CallExpression[callee.object.name='Number'][callee.property.name=/^parse(Float|Int)$/]",
    message: 'No Number.parseFloat/parseInt (INV-ACC-01).',
  },
  {
    selector: "CallExpression[callee.property.name='toFixed']",
    message: 'No toFixed (INV-ACC-01).',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']",
    message: 'No Math.round (INV-ACC-01).',
  },
];

const CLOCK_SYNTAX = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'domain never reads the clock; pass "now" in (04 §3.1).',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'domain never reads the clock; pass "now" in (04 §3.1).',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'domain must be deterministic (04 §3.1).',
  },
];

const UPPER = ['@/data/*', '@/features/*', '@/ui/*', '@/app/*'];
const restrictImports = (group, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
});
const DOMAIN_BANNED = [
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'react-router*',
  '@supabase/*',
  '@tanstack/*',
  ...UPPER,
  '**/data/**',
  '**/features/**',
  '**/ui/**',
  '**/app/**',
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'playwright-report',
      'test-results',
      'supabase/.temp',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      eqeqeq: 'error',
      'no-restricted-syntax': ['error', ...FLOAT_SYNTAX],
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: { ...reactHooks.configs.recommended.rules, ...jsxA11y.flatConfigs.recommended.rules },
  },
  // Layering (04 §3)
  {
    files: ['src/domain/**'],
    rules: {
      ...restrictImports(
        ['luxon', ...DOMAIN_BANNED],
        'domain imports only domain (Luxon only in domain/time).',
      ),
      'no-restricted-syntax': ['error', ...FLOAT_SYNTAX, ...CLOCK_SYNTAX],
    },
  },
  {
    files: ['src/domain/time/**'],
    rules: {
      ...restrictImports(DOMAIN_BANNED, 'domain imports only domain.'),
      'no-restricted-syntax': ['error', ...FLOAT_SYNTAX, ...CLOCK_SYNTAX],
    },
  },
  {
    files: ['src/domain/money/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...CLOCK_SYNTAX,
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message: 'No parseFloat in money paths (INV-ACC-01).',
        },
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message: 'No toFixed (INV-ACC-01).',
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']",
          message: 'No Math.round (INV-ACC-01).',
        },
      ],
    },
  },
  {
    files: ['src/data/**'],
    rules: restrictImports(
      ['@/features/*', '@/ui/*', '@/app/*'],
      'data may not import upward layers.',
    ),
  },
  {
    files: ['src/features/**'],
    rules: restrictImports(['@/app/*'], 'features may not import app.'),
  },
  {
    files: ['src/ui/**'],
    rules: restrictImports(
      ['@/data/*', '@/features/*', '@/app/*', '@/domain/*', '!@/domain/money'],
      'ui imports only domain/money.',
    ),
  },
  {
    files: ['src/ui/charts/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...FLOAT_SYNTAX.filter((r) => !r.message.includes('Number(...)')),
      ],
    },
  },
  {
    files: ['src/app/log.ts', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
  // Tests may exercise forbidden constructs deliberately and may relax type-aware strictness.
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
