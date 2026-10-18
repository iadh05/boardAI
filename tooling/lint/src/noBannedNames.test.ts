import path from 'node:path';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noBannedNames } from './noBannedNames.ts';

// RuleTester calls describe/it itself; point it at Vitest's.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const inRepo = (relative: string): string => path.join(process.cwd(), relative);
const ruleTester = new RuleTester();
const code = 'export const x = 1;';

ruleTester.run('no-banned-names', noBannedNames, {
  valid: [
    { code, filename: inRepo('apps/web/src/modules/board/lib/placement.ts') },
    { code, filename: inRepo('apps/web/src/core/lib/clamp.ts') },
    // only exact names are banned
    { code, filename: inRepo('apps/web/src/core/lib/sharedCursor.ts') },
    { code, filename: inRepo('apps/web/src/core/lib/utilsForDates.ts') },
  ],
  invalid: [
    {
      code,
      filename: inRepo('apps/web/src/modules/board/lib/utils.ts'),
      errors: [{ messageId: 'file' }],
    },
    {
      code,
      filename: inRepo('packages/agent/src/helpers.ts'),
      errors: [{ messageId: 'file' }],
    },
    {
      code,
      filename: inRepo('apps/web/src/modules/board/shared/thing.ts'),
      errors: [{ messageId: 'folder' }],
    },
    {
      code,
      filename: inRepo('apps/server/src/common/errors.ts'),
      errors: [{ messageId: 'folder' }],
    },
    {
      code,
      filename: inRepo('apps/web/src/misc/utils.ts'),
      errors: [{ messageId: 'folder' }, { messageId: 'file' }],
    },
  ],
});
