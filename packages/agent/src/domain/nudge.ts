// The proposal nudge (M1-24e). A small model often recommends a fix in words ("add a Redis cache")
// and calls no tool, so the user gets nothing to accept. The prompt says "call the tools in the same
// answer", but measured, the model ignores it most of the time — so the loop enforces it: when an
// answer recommends a change and proposes nothing, the model is asked once to propose it.

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

/** Said to the model, as the user, after an answer that recommended a change in words only. */
export const PROPOSE_NUDGE =
  'Propose the changes you just recommended now, with the tools, so I can accept them. Do not repeat your explanation.';

// A box someone would add, and a word that says it should be added or is missing.
const COMPONENT =
  /\b(cache|caching|redis|memcached|queue|kafka|rabbitmq|sqs|load ?balancer|replicas?|cdn|storage|worker|database|db)\b/i;
const ACTION =
  /\b(add|adding|introduce|introducing|put|putting|place|deploy|need|needs|missing|lacks?|without|recommend|consider|replicate)\b/i;

/**
 * Whether an answer recommends changing the design. Deliberately simple: a false "yes" costs one
 * extra model call (and a proposal the user can reject); a false "no" leaves the answer as it is.
 */
export const recommendsChange = (answer: string): boolean =>
  COMPONENT.test(answer) && ACTION.test(answer);

/** Asking to be allowed to make the change, instead of proposing it ("Would you like me to…?"). */
const ASKS_PERMISSION =
  /\b(would you like me to|do you want me to|want me to|shall i|should i (add|propose|go ahead)|may i|let me know if you('d| would) like me to)\b/i;
/** The answer's own verdict that nothing has to change: then nothing is to be proposed. */
const NO_CHANGE =
  /\b(no (major |structural |immediate |architectural )?changes? (is |are )?(strictly )?(needed|required|necessary)|nothing (needs|has) to change|no changes? needed)\b/i;

/**
 * Whether to send PROPOSE_NUDGE (M1-29): the answer recommends a change AND asks permission to
 * make it, and doesn't say nothing needs to change. A comparison ("Kafka or RabbitMQ?") or a
 * "the design is fine" answer is left alone, even if it mentions adding something as an option.
 */
export const shouldNudge = (answer: string): boolean =>
  recommendsChange(answer) && ASKS_PERMISSION.test(answer) && !NO_CHANGE.test(answer);
