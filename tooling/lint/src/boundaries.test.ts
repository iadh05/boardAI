import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs the repo's real ESLint config over tooling/lint/fixtures, whose folders mirror
// apps/ and packages/. Each "bad" fixture breaks exactly one architecture rule;
// each "ok" fixture is a legal import that must stay clean.

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const fixturesRoot = path.join(repoRoot, 'tooling/lint/fixtures');

const ARCHITECTURE_RULES = new Set([
  'no-restricted-properties',
  'boundaries/dependencies',
  '@typescript-eslint/no-restricted-imports',
  'designroom/no-banned-names',
  'no-restricted-syntax',
]);

const violationsByFile = new Map<string, string[]>();

beforeAll(async () => {
  // ignore: false — the fixtures are excluded from the normal `pnpm lint` run.
  const eslint = new ESLint({ cwd: repoRoot, ignore: false });
  const results = await eslint.lintFiles([fixturesRoot]);
  for (const result of results) {
    const fatal = result.messages.find((m) => m.fatal);
    if (fatal) throw new Error(`${result.filePath} did not parse: ${fatal.message}`);
    const relative = path.relative(fixturesRoot, result.filePath).split(path.sep).join('/');
    const ruleIds = result.messages
      .map((m) => m.ruleId)
      .filter((id): id is string => id !== null && ARCHITECTURE_RULES.has(id));
    violationsByFile.set(relative, ruleIds);
  }
});

const violationsOf = (fixture: string): string[] => {
  const found = violationsByFile.get(fixture);
  if (!found) throw new Error(`fixture not linted: ${fixture}`);
  return found;
};

describe('package dependency rules', () => {
  it.each([
    ['packages/domain/src/badImportsAgent.ts', 'domain imports no other internal package'],
    ['packages/ai-gateway/src/badImportsDomain.ts', 'ai-gateway imports no other internal package'],
    ['packages/diagram/src/badImportsDomain.ts', 'diagram imports no other internal package'],
    ['packages/agent/src/badValueImport.ts', 'agent may only `import type` from ai-gateway'],
    ['apps/web/src/modules/chat/pods/conversation/badImportsAgent.ts', 'web never imports agent'],
    [
      'apps/web/src/modules/board/pods/canvas/badImportsReactFlow.ts',
      'web never imports the diagram engine',
    ],
  ])('%s is rejected (%s)', (fixture) => {
    expect(violationsOf(fixture)).toEqual(['@typescript-eslint/no-restricted-imports']);
  });

  it('allows the agent to import types from ai-gateway', () => {
    expect(violationsOf('packages/agent/src/okTypeImport.ts')).toEqual([]);
  });
});

describe('web module and pod rules', () => {
  it.each([
    ['apps/web/src/core/ui/atoms/badImportsModule.ts', 'core never imports a module'],
    [
      'apps/web/src/modules/board/pods/toolbar/badDeepIntoCanvas.ts',
      'another pod only via its index.ts',
    ],
    ['apps/web/src/modules/board/pods/toolbar/badImportsChat.ts', 'board never depends on chat'],
    [
      'apps/web/src/modules/chat/pods/conversation/badDeepIntoBoard.ts',
      'another module only via its index.ts',
    ],
    [
      'apps/web/src/modules/chat/pods/conversation/badCrossModulePod.ts',
      "never another module's pod",
    ],
  ])('%s is rejected (%s)', (fixture) => {
    expect(violationsOf(fixture)).toEqual(['boundaries/dependencies']);
  });

  it.each([
    'apps/web/src/modules/board/pods/canvas/okImports.ts',
    'apps/web/src/modules/chat/pods/conversation/okUsesBoard.ts',
  ])('%s is allowed', (fixture) => {
    expect(violationsOf(fixture)).toEqual([]);
  });
});

describe('server module and layer rules', () => {
  it.each([
    ['apps/server/src/core/badImportsModule.ts', 'core never imports a module'],
    ['apps/server/src/modules/chat/domain/badImportsApi.ts', 'domain imports no outer layer'],
    [
      'apps/server/src/modules/chat/application/badImportsInfra.ts',
      'application never imports infra',
    ],
    ['apps/server/src/modules/chat/api/badImportsInfra.ts', 'api never imports infra'],
    ['apps/server/src/modules/health/badDeepIntoChat.ts', 'another module only via its index.ts'],
  ])('%s is rejected (%s)', (fixture) => {
    expect(violationsOf(fixture)).toEqual(['boundaries/dependencies']);
  });

  it.each([
    'apps/server/src/modules/chat/application/reviewBoard.ts',
    'apps/server/src/modules/chat/api/chatRoutes.ts',
    'apps/server/src/modules/chat/infra/ollamaLlm.ts',
    'apps/server/src/modules/health/okUsesChat.ts',
  ])('%s is allowed', (fixture) => {
    expect(violationsOf(fixture)).toEqual([]);
  });
});

describe('naming rules', () => {
  it.each([
    ['apps/web/src/modules/board/lib/utils.ts', 'no utils.ts'],
    ['apps/web/src/modules/board/shared/thing.ts', 'no shared/ folder'],
  ])('%s is rejected (%s)', (fixture) => {
    expect(violationsOf(fixture)).toEqual(['designroom/no-banned-names']);
  });
});

describe('e2e spec rules (docs/rules/e2e.md)', () => {
  it('rejects importing @playwright/test directly in a spec', () => {
    expect(violationsOf('apps/web/e2e/badPlaywrightImport.spec.ts')).toEqual([
      '@typescript-eslint/no-restricted-imports',
    ]);
  });

  it.each([
    ['apps/web/e2e/badSleep.spec.ts', 'no fixed sleeps'],
    ['apps/web/e2e/badDescribeOnly.spec.ts', 'no .only of any kind'],
  ])('%s is rejected (%s)', (fixture) => {
    expect(violationsOf(fixture)).toEqual(['no-restricted-syntax']);
  });

  it('allows a spec that uses the fixtures', () => {
    expect(violationsOf('apps/web/e2e/okUsesFixtures.spec.ts')).toEqual([]);
  });
});

describe('server env rule', () => {
  it('rejects process.env outside core/config.ts', () => {
    expect(violationsOf('apps/server/src/modules/health/badReadsEnv.ts')).toEqual([
      'no-restricted-properties',
    ]);
  });

  it('allows it in core/config.ts', () => {
    expect(violationsOf('apps/server/src/core/config.ts')).toEqual([]);
  });
});
