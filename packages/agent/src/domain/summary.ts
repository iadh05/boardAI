import type { AgentOp, Board } from '@designroom/domain';

// The proposal's summary is for the person deciding Accept or Reject: it names boxes by their
// labels, never by ids or aliases. Built from the ops, so it says exactly what Accept will do.

const MAX_SUMMARY_LENGTH = 500;

const labelOf = (board: Board, id: string) =>
  JSON.stringify(board.nodes.find((n) => n.id === id)?.label ?? id);

/**
 * Each box's name at this point of the proposal: as on the board the user sees, or as added
 * earlier in the proposal — so a box the model adds then renames is never shown by its id.
 */
type NamesSoFar = Map<string, string>;

const describe = (op: AgentOp, after: Board, names: NamesSoFar): string => {
  switch (op.op) {
    case 'addNode':
      names.set(op.nodeId, op.label);
      return `add ${op.kind} ${labelOf(after, op.nodeId)}`;
    case 'updateNode': {
      const parts = [
        op.label !== undefined ? `rename to ${JSON.stringify(op.label)}` : '',
        op.kind !== undefined ? `make it a ${op.kind}` : '',
      ].filter(Boolean);
      const name = JSON.stringify(names.get(op.nodeId) ?? op.nodeId);
      if (op.label !== undefined) names.set(op.nodeId, op.label);
      return `change ${name}: ${parts.join(', ')}`;
    }
    case 'connect': {
      const how = [op.mode === 'async' ? 'async' : '', op.label ? JSON.stringify(op.label) : ''];
      const details = how.filter(Boolean).join(', ');
      const arrow = `connect ${labelOf(after, op.source)} → ${labelOf(after, op.target)}`;
      return details ? `${arrow} (${details})` : arrow;
    }
  }
};

/** "Add cache "Redis"; connect "API" → "Redis"" — `before` is the board the user sees now. */
export const summarize = (ops: readonly AgentOp[], before: Board, after: Board): string => {
  const names: NamesSoFar = new Map(before.nodes.map((n) => [n.id, n.label]));
  const text = ops
    .map((op, i) => {
      const line = describe(op, after, names);
      return i === 0 ? line[0]?.toUpperCase() + line.slice(1) : line;
    })
    .join('; ');
  return text.length <= MAX_SUMMARY_LENGTH ? text : `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
};
