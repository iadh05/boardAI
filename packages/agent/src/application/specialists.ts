import { checkDesign, checkSecurity, type Board, type DesignRule } from '@designroom/domain';
import type { Finding, Severity } from '../domain/findings.ts';
import type { TaskCard } from '../domain/tasks.ts';
import type { Specialist } from './orchestrator.ts';

// The first specialists (AV2-06): Data and Security, rules first. What code can see every time
// stays code (architecture-v2 § Specialists): these return typed findings with confidence 1, and
// the Architect / Main agent explain them against the requirements. An LLM specialist is added for
// a concern only when no rule can see it — and then measured on these same eval boards.

/** Which design rules are the Data specialist's, and how severe each is. */
const DATA_RULES: Partial<Record<DesignRule, Severity>> = {
  'single-database': 'critical',
  'no-cache': 'warn',
};

/** A finding stays in the card's scope: one of its boxes is on the card (no boxes: whole board). */
const inScope = (card: TaskCard, boxIds: readonly string[]) =>
  card.boxIds.length === 0 || boxIds.some((id) => card.boxIds.includes(id));

const data: Specialist = ({ card, board }) =>
  Promise.resolve(
    checkDesign(board).flatMap((f): Finding[] => {
      const severity = DATA_RULES[f.rule];
      return severity && inScope(card, f.nodeIds)
        ? [
            {
              specialist: 'data',
              kind: f.rule,
              boxIds: f.nodeIds,
              severity,
              problem: f.problem,
              fix: f.fix,
              confidence: 1,
            },
          ]
        : [];
    }),
  );

const security: Specialist = ({ card, board }: { card: TaskCard; board: Board }) =>
  Promise.resolve(
    checkSecurity(board)
      .filter((f) => inScope(card, f.nodeIds))
      .map((f): Finding => ({
        specialist: 'security',
        kind: f.rule,
        boxIds: f.nodeIds,
        severity: f.severity,
        problem: f.problem,
        fix: f.fix,
        confidence: 1,
      })),
  );

/** The rule-based specialists, by the name a task card uses. */
export const RULE_SPECIALISTS = { data, security } as const satisfies Record<string, Specialist>;
