import type { AgentOp, Board } from '@designroom/domain';

// The proposal's summary is for the person deciding Accept or Reject: it names boxes by their
// labels, never by ids or aliases. Built from the ops, so it says exactly what Accept will do.

const MAX_SUMMARY_LENGTH = 500;

const labelOf = (board: Board, id: string) =>
  JSON.stringify(board.nodes.find((n) => n.id === id)?.label ?? id);

const describe = (op: AgentOp, after: Board, before: Board): string => {
  switch (op.op) {
    case 'addNode':
      return `Add ${op.kind} ${labelOf(after, op.nodeId)}`;
    case 'updateNode': {
      const parts = [
        op.label !== undefined ? `rename to ${JSON.stringify(op.label)}` : '',
        op.kind !== undefined ? `make it a ${op.kind}` : '',
      ].filter(Boolean);
      return `Change ${labelOf(before, op.nodeId)}: ${parts.join(', ')}`;
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
  const text = ops
    .map((op, i) => {
      const line = describe(op, after, before);
      return i === 0 ? line[0]?.toUpperCase() + line.slice(1) : line;
    })
    .join('; ');
  return text.length <= MAX_SUMMARY_LENGTH ? text : `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
};
