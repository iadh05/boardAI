import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bannedNamesIn } from './noBannedNames.ts';

// The ESLint rule only sees files ESLint lints (TS/JS). This test checks every file git tracks —
// CSS, JSON, images, anything — so a `shared/` folder can't hide behind non-code files.

const repoRoot = path.resolve(import.meta.dirname, '../../..');
// Deliberately badly named fixtures that prove the lint rules work.
const allowedPrefix = 'tooling/lint/fixtures/';

describe('every tracked file has an allowed name', () => {
  it('contains no shared/, common/, misc/ folders and no utils/helpers files', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n')
      .filter((file) => file !== '' && !file.startsWith(allowedPrefix));

    const offenders = tracked.filter((file) => bannedNamesIn(file).length > 0);

    expect(offenders).toEqual([]);
  });
});

describe('bannedNamesIn', () => {
  it('reports banned folders for any file type', () => {
    expect(bannedNamesIn('apps/web/src/shared/styles.css')).toEqual(['shared/']);
    expect(bannedNamesIn('apps/web/src/common/icons/logo.svg')).toEqual(['common/']);
  });

  it('reports banned file names', () => {
    expect(bannedNamesIn('packages/agent/src/helpers.ts')).toEqual(['helpers.ts']);
  });

  it('accepts names that only contain a banned word', () => {
    expect(bannedNamesIn('apps/web/src/core/lib/sharedCursor.ts')).toEqual([]);
  });
});
