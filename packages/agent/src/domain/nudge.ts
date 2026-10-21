// The loop's two reminders (M1-24e, M1-31). A small model often recommends a fix in words and
// calls no tool, so the user gets nothing to accept. Since M1-31 every answer must end with a tool
// call — the changes, or no_change with the reason — and an answer with none is reminded once.
// No guessing from words: the word lists of M1-24e and M1-29 are gone (they missed "auth service",
// fired on "you don't need a cache", and knew no French).

import type { AgentOp } from '@designroom/domain';

/**
 * New boxes no arrow touches yet. Measured with the 3-box cap, the model often added a load
 * balancer and stopped: a floating box fixes nothing, so the loop asks once to connect it.
 */
export const unconnectedNewBoxes = (ops: readonly AgentOp[]): string[] => {
  const linked = new Set(ops.flatMap((op) => (op.op === 'connect' ? [op.source, op.target] : [])));
  return ops.flatMap((op) => (op.op === 'addNode' && !linked.has(op.nodeId) ? [op.nodeId] : []));
};

/** Said to the model, as the user, naming the boxes it left unconnected (`n5 "Orders LB"`). */
export const connectNudge = (boxes: readonly string[]): string =>
  `Connect the boxes you added to the boxes they work with, with connect_nodes: ${boxes.join(', ')}. Do not add new boxes.`;

/** Said to the model, as the user, after an answer with no tool call at all (M1-31). */
export const PROPOSE_NUDGE =
  'End your answer with a tool call: propose the changes you recommend with the tools, so I can accept them, or call no_change with the reason if nothing should change. Do not repeat your explanation.';
