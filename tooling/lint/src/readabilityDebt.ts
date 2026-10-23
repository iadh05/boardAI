// The readability debt (ADR-014): files over a readability limit when the rules arrived
// (2026-10-22). They warn instead of failing, and leave this list when fixed (ticket CI-02).
// The list only shrinks: tooling/lint/src/readabilityDebt.test.ts checks it.

/** How many files were on the list at the start. Lower it as files leave; never raise it. */
export const DEBT_AT_START = 0;

export const READABILITY_DEBT: readonly string[] = [];
