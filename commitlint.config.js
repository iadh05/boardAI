// Commit messages follow Conventional Commits — docs/rules/general.md § Git.
// Example: feat(domain): M1-05 add board schemas
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects start with a ticket id ("M1-05 …"), which the default case rule rejects.
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
