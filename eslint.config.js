import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { designroomPlugin } from './tooling/lint/src/index.ts';

// ─── Architecture rules (docs/architecture.md §3, §5.2, §6.1) ────────────────────────────
// Proven by the fixture tests in tooling/lint (`pnpm --filter @designroom/lint test`).

const internalPackage = (name, why) => ({ name: `@designroom/${name}`, message: why });

/** Package graph: which @designroom/* package may import which (architecture §3). */
const packageRules = [
  {
    files: ['**/packages/domain/src/**/*.ts', '**/packages/ai-gateway/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@designroom/*'],
              message:
                'domain and ai-gateway depend on no other internal package (architecture §3).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/packages/agent/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              ...internalPackage(
                'ai-gateway',
                'agent may only `import type` from ai-gateway; the real gateway is injected (architecture §3).',
              ),
              allowTypeImports: true,
            },
          ],
          patterns: [
            {
              group: ['@designroom/*', '!@designroom/domain', '!@designroom/ai-gateway'],
              message: 'agent may import only domain (and types from ai-gateway).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/apps/web/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            internalPackage('agent', 'The browser never imports agent code (architecture §3).'),
            internalPackage('ai-gateway', 'The browser never talks to LLMs (architecture §3).'),
          ],
        },
      ],
    },
  },
];

/** Inside the apps: web modules/pods (§5.2) and server modules/layers (§6.1). */
const sameModule = '{{ from.element.captured.module }}';
const otherModule = `!${sameModule}`;
const notIndex = '!index.ts';
const webBusiness = '{web-pod,web-module}';
const serverModuleCode = '{server-module,server-api,server-application,server-domain,server-infra}';

const appRules = {
  files: ['**/apps/*/src/**/*.{ts,tsx}'],
  plugins: { boundaries },
  settings: {
    'import/resolver': { typescript: { alwaysTryTypes: true } },
    'boundaries/legacy-templates': false,
    // Patterns match from the end of a path, so tooling/lint/fixtures/apps/... is classified
    // exactly like apps/... . More specific patterns first.
    'boundaries/elements': [
      { type: 'web-pod', pattern: 'web/src/modules/*/pods/*', capture: ['module', 'pod'] },
      { type: 'web-module', pattern: 'web/src/modules/*', capture: ['module'] },
      { type: 'web-core', pattern: 'web/src/core' },
      { type: 'web-app', pattern: 'web/src/app' },
      { type: 'web-layout', pattern: 'web/src/layout' },
      { type: 'server-api', pattern: 'server/src/modules/*/api', capture: ['module'] },
      {
        type: 'server-application',
        pattern: 'server/src/modules/*/application',
        capture: ['module'],
      },
      { type: 'server-domain', pattern: 'server/src/modules/*/domain', capture: ['module'] },
      { type: 'server-infra', pattern: 'server/src/modules/*/infra', capture: ['module'] },
      { type: 'server-module', pattern: 'server/src/modules/*', capture: ['module'] },
      { type: 'server-core', pattern: 'server/src/core' },
    ],
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        // Everything is allowed except the edges below — easier to read than an allow-list.
        default: 'allow',
        policies: [
          // ── web ──
          {
            // core/ is generic: it knows nothing about modules, pages or layouts.
            message:
              'web core/ is generic and must not import modules, pages or layouts (frontend rules: Structure).',
            from: { element: { type: 'web-core' } },
            disallow: { to: { element: { type: '{web-pod,web-module,web-app,web-layout}' } } },
          },
          {
            // Another pod of the same module only through its index.ts.
            message: 'Import another pod only through its index.ts (frontend rules: Structure).',
            from: { element: { type: 'web-pod' } },
            disallow: {
              to: {
                element: {
                  type: 'web-pod',
                  captured: { module: sameModule, pod: '!{{ from.element.captured.pod }}' },
                  fileInternalPath: notIndex,
                },
              },
            },
          },
          {
            // Never another module's pods.
            message:
              "Never import another module's pods; use that module's index.ts (frontend rules: Structure).",
            from: { element: { type: webBusiness } },
            disallow: { to: { element: { type: 'web-pod', captured: { module: otherModule } } } },
          },
          {
            // Another module only through its index.ts.
            message: 'Import another module only through its index.ts (frontend rules: Structure).',
            from: { element: { type: webBusiness } },
            disallow: {
              to: {
                element: {
                  type: 'web-module',
                  captured: { module: otherModule },
                  fileInternalPath: notIndex,
                },
              },
            },
          },
          {
            // Direction: chat → board, never board → chat.
            message:
              'board must not depend on chat: the direction is chat → board (architecture §5.2).',
            from: { element: { type: webBusiness, captured: { module: 'board' } } },
            disallow: { to: { element: { type: webBusiness, captured: { module: 'chat' } } } },
          },
          {
            // Modules don't reach up into pages or layouts.
            message: 'Modules must not import pages (app/) or layouts (layout/).',
            from: { element: { type: webBusiness } },
            disallow: { to: { element: { type: '{web-app,web-layout}' } } },
          },

          // ── server ──
          {
            message: 'server core/ must not import modules (backend rules: Modular monolith).',
            from: { element: { type: 'server-core' } },
            disallow: { to: { element: { type: serverModuleCode } } },
          },
          {
            // Layers point inward: api → application → domain; infra implements application ports.
            message:
              'domain/ is the innermost layer: it must not import api/, application/ or infra/ (backend rules: Four layers).',
            from: { element: { type: 'server-domain' } },
            disallow: { to: { element: { type: '{server-api,server-application,server-infra}' } } },
          },
          {
            message:
              'application/ must not import api/ or infra/; declare a port and let infra implement it (backend rules: Four layers).',
            from: { element: { type: 'server-application' } },
            disallow: { to: { element: { type: '{server-api,server-infra}' } } },
          },
          {
            message:
              'api/ must not import infra/; go through an application use case (backend rules: Four layers).',
            from: { element: { type: 'server-api' } },
            disallow: { to: { element: { type: 'server-infra' } } },
          },
          {
            // Another module only through its index.ts (as if it were a remote service).
            message:
              'Use another module only through its index.ts, as if it were a remote service (backend rules: Modular monolith).',
            from: { element: { type: serverModuleCode } },
            disallow: {
              to: {
                element: {
                  type: '{server-api,server-application,server-domain,server-infra}',
                  captured: { module: otherModule },
                },
              },
            },
          },
          {
            message:
              'Use another module only through its index.ts, as if it were a remote service (backend rules: Modular monolith).',
            from: { element: { type: serverModuleCode } },
            disallow: {
              to: {
                element: {
                  type: 'server-module',
                  captured: { module: otherModule },
                  fileInternalPath: notIndex,
                },
              },
            },
          },
        ],
      },
    ],
  },
};

// ─── Full config ──────────────────────────────────────────────────────────────────────────

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      // Deliberately broken code; linted only by tooling/lint's tests.
      'tooling/lint/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          // Tool config files (vite/vitest/playwright) live outside `src`, so no tsconfig includes them.
          allowDefaultProject: [
            'apps/*/*.config.ts',
            'packages/*/*.config.ts',
            'tooling/*/*.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { designroom: designroomPlugin },
    rules: {
      // docs/rules/general.md — no console.log in committed code.
      'no-console': 'error',
      // docs/rules/general.md — named exports only.
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: {
            direct: true,
            named: true,
            defaultFrom: true,
            namedFrom: true,
            namespaceFrom: true,
          },
        },
      ],
      // docs/rules/backend.md — no floating promises.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // `const { removed, ...rest } = obj` is the idiomatic way to drop a key.
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // docs/rules/general.md — no shared/, common/, misc/, utils.ts, helpers.ts.
      'designroom/no-banned-names': 'error',
    },
  },
  ...packageRules,
  appRules,
  {
    // Tool config files must use a default export.
    files: ['**/*.config.{js,ts}'],
    rules: { 'no-restricted-exports': 'off' },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
