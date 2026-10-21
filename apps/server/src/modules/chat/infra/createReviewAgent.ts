import { createAgent, createReviewerV2, RULE_SPECIALISTS } from '@designroom/agent';
import type { AiGateway } from '@designroom/ai-gateway';
import type { ReviewAgent } from '../application/reviewBoard.ts';
import { CHAT_POLICY } from '../domain/chatPolicy.ts';

/**
 * The real agent behind the use case's port: our agent package on the injected LLM gateway. The
 * canary is new at each server start, so it can't be learned from the repo (M1-24d).
 */
export const createReviewAgent = (
  llm: AiGateway,
  options: { recordContent?: boolean } = {},
): ReviewAgent =>
  createAgent({
    llm,
    ...options,
    newId: () => crypto.randomUUID(),
    maxRounds: CHAT_POLICY.maxRounds,
    canary: `dr-${crypto.randomUUID().slice(0, 8)}`,
  });

/** A gateway per agent role (AV2-04): hosted with the local model behind it, or local. */
export type RoleGateways = {
  main: AiGateway;
  planner: AiGateway;
  specialist: AiGateway;
  critic: AiGateway;
};

/**
 * Agent V2 (AV2-09): Main and Planner on their roles' models, the rule specialists (AV2-06), and
 * AV2-01's agent as the Architect on the specialists' model. The Critic (AV2-08) when asked for:
 * its LLM only when a critic model is configured (D14: another model family), else code checks.
 */
export const createReviewAgentV2 = (
  gateways: RoleGateways,
  options: { recordContent?: boolean; critic?: boolean; criticModel?: boolean } = {},
): ReviewAgent =>
  createReviewerV2({
    main: gateways.main,
    planner: gateways.planner,
    architect: createAgent({
      llm: gateways.specialist,
      ...(options.recordContent === undefined ? {} : { recordContent: options.recordContent }),
      newId: () => crypto.randomUUID(),
      maxRounds: CHAT_POLICY.maxRounds,
      canary: `dr-${crypto.randomUUID().slice(0, 8)}`,
    }),
    specialists: RULE_SPECIALISTS,
    ...(options.critic ? { critic: options.criticModel ? { llm: gateways.critic } : {} } : {}),
  });
