// @ts-check
/**
 * Shared ESLint flat config (ESLint 10, typescript-eslint 8, type-aware).
 * Usage (root eslint.config.js):
 *   import { meniscus } from '@meniscus/config/eslint'
 *   export default meniscus({ tsconfigRootDir: import.meta.dirname })
 */
import js from '@eslint/js'
import stylexPlugin from '@stylexjs/eslint-plugin'
import prettier from 'eslint-config-prettier/flat'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** postgres-store: the chart lives in Postgres only (Drizzle, src/db); no SQLite store comes back. */
const NO_SQLITE = { name: 'node:sqlite', message: 'The chart is in Postgres (src/db, Drizzle); no SQLite.' }

/** @type {import('eslint').ESLint.Plugin} StyleX ships rule meta typed loosely. */
const stylex = /** @type {any} */ (stylexPlugin)

/**
 * Import boundaries (architecture as lint rules):
 * - packages/* are libraries: never import apps.
 * - @meniscus/meta is a generic Meta API client: no app domain (@meniscus/shared), no zod.
 * - the web app never imports server code at runtime.
 * - nothing in server src/ outside src/lab imports src/lab (dev-only modules for scripts/).
 */
/** @type {import('eslint').Linter.Config[]} */
const boundaries = [
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/apps/**', '@meniscus/server', '@meniscus/web'], message: 'Packages must not import apps.' }] },
      ],
    },
  },
  {
    files: ['packages/meta/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/apps/**', '@meniscus/server', '@meniscus/web'], message: 'Packages must not import apps.' },
            { group: ['@meniscus/shared', '@meniscus/shared/*'], message: '@meniscus/meta is domain-free; map types in the app.' },
            { group: ['zod', 'openai'], message: '@meniscus/meta stays dependency-free: use StandardSchema and fetch.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/apps/server/**', '@meniscus/server', '@meniscus/meta'], message: 'Web talks to the server over HTTP only.' },
          ],
        },
      ],
    },
  },
  {
    // Matches a lab/ folder, not a file named lab.ts (read-outcomes' src/chart/lab.ts stays importable).
    files: ['apps/server/src/**/*.ts'],
    ignores: ['apps/server/src/lab/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [NO_SQLITE],
          patterns: [{ group: ['**/lab/**'], message: 'src/lab is dev-only: scripts import it; nothing else in src does.' }],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/lab/**/*.ts', 'apps/server/scripts/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [NO_SQLITE] }] },
  },
]

/** @param {{ tsconfigRootDir: string }} opts */
export function meniscus({ tsconfigRootDir }) {
  return defineConfig(
    globalIgnores(['**/node_modules/', '**/dist/', '**/dev-dist/', '**/*.gen.ts', 'openspec/', '.claude/']),

    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
        globals: { ...globals.node },
      },
      rules: {
        eqeqeq: ['error', 'smart'],
        'no-console': 'off',
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-floating-promises': [
          'error',
          // node:test's describe/it return promises the runner tracks itself.
          { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it', 'test', 'suite'] }] },
        ],
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/only-throw-error': 'error',
      },
    },
    { files: ['**/*.js', '**/*.cjs', '**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
    {
      files: ['**/*.test.ts', '**/src/testing.ts', '**/scripts/**/*.ts'],
      rules: {
        // Tests and scripts poke at untyped JSON on purpose.
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },

    {
      files: ['apps/web/**/*.{ts,tsx}'],
      languageOptions: { globals: { ...globals.browser } },
      // TanStack Router file routes export `Route` next to their component.
      extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite({ allowExportNames: ['Route'] })],
      plugins: { '@stylexjs': stylex },
      rules: {
        '@stylexjs/valid-styles': 'error',
        '@stylexjs/valid-shorthands': 'error',
        '@stylexjs/no-unused': 'error',
        '@stylexjs/enforce-extension': 'error',
        // TanStack Router control flow: `throw redirect(...)` / `throw notFound()`.
        '@typescript-eslint/only-throw-error': [
          'error',
          { allow: [{ from: 'package', package: '@tanstack/router-core', name: ['Redirect', 'NotFoundError'] }] },
        ],
      },
    },

    {
      // File routes: TanStack's router plugin code-splits route components and owns their HMR.
      files: ['apps/web/src/routes/**/*.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },

    ...boundaries,
    prettier,
  )
}
