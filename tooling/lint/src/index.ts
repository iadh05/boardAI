import type { ESLint } from 'eslint';
import { noBannedNames } from './noBannedNames.ts';

// Local ESLint plugin, registered in the root eslint.config.js as "designroom".
export const designroomPlugin: ESLint.Plugin = {
  meta: { name: '@designroom/lint' },
  rules: {
    'no-banned-names': noBannedNames,
  },
};
