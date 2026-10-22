import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { designroomPlugin } from './tooling/lint/src/index.ts';
import { READABILITY_DEBT } from './tooling/lint/src/readabilityDebt.ts';

// ─── Architecture rules (docs/architecture.md §3, §5.2, §6.1) ────────────────────────────
// Proven by the fixture tests in tooling/lint (`pnpm --filter @designroom/lint test`).

const internalPackage = (name, why) => ({ name: `@designroom/${name}`, message: why });

/**
 * Model ids and hosted-provider URLs: as an esquery regex, for the no-magic-strings rule below.
 * Matches the families we use (Claude, gpt-oss, Gemini, Qwen on Groq) and the providers' hosts.
 */
const MAGIC_MODEL_STRINGS =
  '/(claude-(haiku|sonnet|opus|fable)|gpt-oss|gemini-[0-9]|qwen\\u002f|api\\.groq\\.com|generativelanguage\\.googleapis|api\\.anthropic\\.com)/';

/** The diagram engine lives behind @designroom/diagram; the app never touches it (ADR-004). */
const DIAGRAM_ENGINES = ['@xyflow/react', 'libavoid-js'].map((name) => ({
  name,
  message: 'Use @designroom/diagram: the diagram engine stays behind its API (ADR-004).',
}));

/** Package graph: which @designroom/* package may import which (architecture §3). */
const packageRules = [
  {
    files: [
      '**/packages/domain/src/**/*.ts',
      '**/packages/ai-gateway/src/**/*.ts',
      '**/packages/diagram/src/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@designroom/*'],
              message:
                'domain, ai-gateway and diagram depend on no other internal package (architecture §3, ADR-004).',
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
            ...DIAGRAM_ENGINES,
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

/**
 * Which web modules each module may use (through their index.ts). Every module must be listed:
 * a module missing here may use no other module. Add new modules when you create them.
 * (architecture §5.2 — the direction is chat → board.)
 */
const WEB_MODULE_DEPENDENCIES = {
  board: [],
  chat: ['board'],
  room: ['board'], // M2: connects the board's shared document to a room
};

/** Glob for "any of these names" — braces need 2+ names, so a single name stays plain. */
const anyOf = (names) => (names.length === 1 ? names[0] : `{${names.join(',')}}`);

/** One policy per module: block every other module that isn't in its list. */
const webModuleDirectionPolicies = Object.entries(WEB_MODULE_DEPENDENCIES).map(
  ([module, allowed]) => ({
    message: allowed.length
      ? `The ${module} module may only depend on: ${allowed.join(', ')} (WEB_MODULE_DEPENDENCIES in eslint.config.js).`
      : `The ${module} module must not depend on other modules (WEB_MODULE_DEPENDENCIES in eslint.config.js).`,
    from: { element: { type: webBusiness, captured: { module } } },
    disallow: {
      to: {
        element: {
          type: webBusiness,
          captured: { module: `!${anyOf([module, ...allowed])}` },
        },
      },
    },
  }),
);
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
          // Direction between modules: generated from WEB_MODULE_DEPENDENCIES.
          ...webModuleDirectionPolicies,
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

// Readability guardrails (ADR-014): what a reviewer would otherwise catch by reading. A function
// over 80 lines or 15 of cognitive complexity, or a file over 300 lines, fails — tests excepted
// (a describe block is long by nature). Files already over a limit when the rules arrived
// (2026-10-22) only warn, and leave this list when they're fixed (ticket CI-02): it only shrinks.
const READABILITY_RULES = (level) => ({
  'sonarjs/cognitive-complexity': [level, 15],
  'max-lines-per-function': [level, { max: 80, skipBlankLines: true, skipComments: true }],
  'max-lines': [level, { max: 300, skipBlankLines: true, skipComments: true }],
});
const NOT_TESTS = ['**/*.test.{ts,tsx}', 'apps/web/e2e/**', '**/fixtures/**'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      // Deliberately broken code; linted only by tooling/lint's tests.
      'tooling/lint/fixtures/**',
      // Plain-JS dev scripts that load the server's yjs at run time: no types for the typed rules.
      'scripts/*.mjs',
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
    // docs/rules/backend.md — env is read only in core/config.ts (validated at startup).
    files: ['**/apps/server/src/**/*.ts'],
    ignores: ['**/apps/server/src/core/config.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read env only in core/config.ts (zod-validated at startup).',
        },
      ],
    },
  },
  {
    // docs/rules/general.md — no magic strings: model ids and provider URLs live in the gateway's
    // catalogue only; code reads them there. Which model a role uses is configuration (LLM_ROLE_*).
    // Tests and recorded fixtures may name models: they describe one.
    files: ['**/apps/**/*.ts', '**/packages/**/*.ts', '**/scripts/**/*.ts'],
    ignores: ['**/packages/ai-gateway/src/catalogue.ts', '**/*.test.ts', '**/apps/web/e2e/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${MAGIC_MODEL_STRINGS}]`,
          message:
            'A model id or provider URL: read it from the catalogue (packages/ai-gateway/src/catalogue.ts), or configure it.',
        },
        {
          selector: `TemplateElement[value.raw=${MAGIC_MODEL_STRINGS}]`,
          message:
            'A model id or provider URL: read it from the catalogue (packages/ai-gateway/src/catalogue.ts), or configure it.',
        },
      ],
    },
  },
  {
    // React in the browser: hooks rules + safe Fast Refresh (docs/rules/frontend.md).
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/diagram/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    ...reactHooks.configs.flat['recommended-latest'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },
  {
    // E2E specs (docs/rules/e2e.md): page objects come from the fixtures; no sleeps; no test.only.
    files: ['**/apps/web/e2e/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                'Import test/expect from ./fixtures.ts so page objects are injected (docs/rules/e2e.md).',
            },
            // Repeat the web package rules: this block replaces them for spec files.
            internalPackage('agent', 'The browser never imports agent code (architecture §3).'),
            internalPackage('ai-gateway', 'The browser never talks to LLMs (architecture §3).'),
            ...DIAGRAM_ENGINES,
          ],
        },
      ],
    },
  },
  {
    // All E2E code — specs, page objects, fixtures: no sleeps, no focused tests.
    files: ['**/apps/web/e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'No fixed sleeps: wait for a locator, response or URL instead (docs/rules/e2e.md).',
        },
        {
          // test.only, test.describe.only, it.only … — any `.only(...)` call.
          selector: "CallExpression[callee.property.name='only']",
          message: '.only would skip every other test (docs/rules/e2e.md).',
        },
      ],
    },
  },
  {
    // Tool config files must use a default export; declaration files describe other modules'
    // shapes (e.g. Vite's `?url` imports), which may be default exports.
    files: ['**/*.config.{js,ts}', '**/*.d.ts'],
    rules: { 'no-restricted-exports': 'off' },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: NOT_TESTS,
    plugins: { sonarjs },
    rules: READABILITY_RULES('error'),
  },
  ...(READABILITY_DEBT.length > 0
    ? [{ files: READABILITY_DEBT, ignores: NOT_TESTS, rules: READABILITY_RULES('warn') }]
    : []),
  prettier,
);
