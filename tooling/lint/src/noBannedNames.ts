import path from 'node:path';
import type { Rule } from 'eslint';

// docs/rules/general.md — "folders or files named shared, common, misc, utils.ts, helpers.ts".
// Vague names become junk drawers; name things by what they are.
const BANNED_FOLDERS = new Set(['shared', 'common', 'misc']);
const BANNED_FILE = /^(utils|helpers)\.[cm]?[jt]sx?$/;

/**
 * Banned names in a repo-relative path: `"shared/"` for a folder, `"utils.ts"` for a file.
 * Used by the ESLint rule (code files) and by repoNames.test.ts (every tracked file).
 */
export const bannedNamesIn = (relativePath: string): string[] => {
  const segments = relativePath.split(/[\\/]/);
  const fileName = segments.at(-1) ?? '';
  const banned = segments
    .slice(0, -1)
    .filter((segment) => BANNED_FOLDERS.has(segment))
    .map((folder) => `${folder}/`);
  if (BANNED_FILE.test(fileName)) banned.push(fileName);
  return banned;
};

export const noBannedNames: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow vague folder and file names (shared/, common/, misc/, utils.ts, helpers.ts)',
    },
    messages: {
      folder:
        'Folder "{{name}}" is banned: name the folder after what it holds (store/, mappers/, lib/…).',
      file: 'File "{{name}}" is banned: name the file after what it does (placement.ts, kindMeta.ts…).',
    },
    schema: [],
  },
  create(context) {
    return {
      Program(node) {
        // Only look inside the repo, so a folder named "shared" above it doesn't count.
        for (const name of bannedNamesIn(path.relative(context.cwd, context.filename))) {
          const messageId = name.endsWith('/') ? 'folder' : 'file';
          context.report({ node, messageId, data: { name } });
        }
      },
    };
  },
};
