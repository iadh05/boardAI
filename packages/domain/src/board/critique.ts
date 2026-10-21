import { applyOps, type AgentOp } from './agentOps.ts';
import type { Board } from './board.ts';
import { oneOfAKindJob } from './designChecks.ts';

// The Critic's code checks (AV2-08, D9): what a proposal must never do, checked in code before the
// user sees it — the same 9B that proposed can't catch its own blind spots. The tools already
// refuse most of these one call at a time; this checks the proposal as a whole.

export type CritiqueCheck =
  'invalid' | 'kind-changed' | 'floating' | 'duplicate' | 'too-many-boxes';

export type CritiqueIssue = { check: CritiqueCheck; nodeIds: string[]; problem: string };

/**
 * A label as the issue text names it: JSON-quoted, with < and > escaped — the issues go into the
 * model's <critique> block, and a label is user text that must not close it (review of AV2-05..09).
 */
const escaped = (text: string) =>
  text.replace(/[<>]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const quoted = (label: string) => escaped(JSON.stringify(label));

/** New boxes in one proposal (the same cap as the agent's tools). */
const MAX_NEW_BOXES = 3;

export const critiqueProposal = (board: Board, ops: readonly AgentOp[]): CritiqueIssue[] => {
  const applied = applyOps(board, ops);
  if (!applied.ok)
    return [{ check: 'invalid', nodeIds: [], problem: escaped(applied.error.message) }];

  const added = ops.flatMap((op) => (op.op === 'addNode' ? [op] : []));
  const linked = new Set(ops.flatMap((op) => (op.op === 'connect' ? [op.source, op.target] : [])));
  const issues: CritiqueIssue[] = [];

  for (const op of ops)
    if (op.op === 'updateNode' && op.kind !== undefined) {
      const before = board.nodes.find((n) => n.id === op.nodeId);
      if (before && before.kind !== op.kind)
        issues.push({
          check: 'kind-changed',
          nodeIds: [op.nodeId],
          problem: `turns the ${before.kind} ${quoted(before.label)} into a ${op.kind}: a new box should do that`,
        });
    }
  for (const op of added) {
    if (!linked.has(op.nodeId))
      issues.push({
        check: 'floating',
        nodeIds: [op.nodeId],
        problem: `${quoted(op.label)} has no arrow`,
      });
    const job = oneOfAKindJob(op.kind, op.label);
    const existing = job && board.nodes.find((n) => oneOfAKindJob(n.kind, n.label) === job);
    if (existing)
      issues.push({
        check: 'duplicate',
        nodeIds: [op.nodeId],
        problem: `${quoted(op.label)} does the job of ${quoted(existing.label)}, already on the board`,
      });
  }
  if (added.length > MAX_NEW_BOXES)
    issues.push({
      check: 'too-many-boxes',
      nodeIds: added.map((op) => op.nodeId),
      problem: `${added.length} new boxes: a review proposes the few fixes that matter (at most ${MAX_NEW_BOXES})`,
    });
  return issues;
};
