// The proposal nudge (M1-24e). A small model often recommends a fix in words ("add a Redis cache")
// and calls no tool, so the user gets nothing to accept. The prompt says "call the tools in the same
// answer", but measured, the model ignores it most of the time — so the loop enforces it: when an
// answer recommends a change and proposes nothing, the model is asked once to propose it.

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
