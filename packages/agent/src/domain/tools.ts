import type { ToolDefinition } from '@designroom/ai-gateway';
import {
  applyOps,
  checkDesign,
  EdgeModeSchema,
  MAX_OPS_PER_PROPOSAL,
  NodeKindSchema,
  oneOfAKindJob,
  type AgentOp,
  type Board,
  type DesignFinding,
  type NodeKind,
} from '@designroom/domain';
import { z } from 'zod';
import { createAliases, type Aliases } from './aliases.ts';
import { quote } from './boardToText.ts';

// The agent's tools (architecture §7, M1-32): look (check_design), change (add_node, update_node,
// connect_nodes — and no delete), ask (ask_user) and end (finish). Every rule the model must follow
// is in a tool's description or checked in its code, and a refusal is a tool result: an
// observation the model reads next round, never a message pretending to be the user.
// Flat arguments on purpose: small local models call simple tools much more reliably.
// Each call is checked twice: its arguments with zod, then the resulting op with applyOps on a
// draft of the board — the same code the browser runs on Accept. A failure goes back to the model
// as the tool result, so it can fix the call in the next round.

/** The board as the agent changes it during one run, plus the ops that make up the proposal. */
export type Draft = { board: Board; aliases: Aliases; ops: AgentOp[] };

export const createDraft = (board: Board): Draft => ({
  board,
  aliases: createAliases(board),
  ops: [],
});

export type ToolCallInput = { name: string; arguments: unknown };
export type ToolOutcome = {
  draft: Draft;
  ok: boolean;
  reply: string;
  /** The model ended its answer: with finish (its summary) or ask_user (its question). */
  end?: { tool: typeof FINISH | typeof ASK_USER; text: string };
};
export type ToolDeps = {
  /** New node and edge ids. The agent chooses them, never the model (M1-08 review). */
  newId: () => string;
};

const NodeRef = z.string().min(1).max(64);

const AddNodeArgs = z.object({
  kind: NodeKindSchema.describe('What the component is; use "custom" for anything else.'),
  label: z.string().describe('Short name shown on the box, e.g. "Redis cache".'),
  near: NodeRef.optional().describe('Id (like "n3") of the node it relates to; placed next to it.'),
});

const UpdateNodeArgs = z.object({
  nodeId: NodeRef.describe('Id of the node to change, like "n3".'),
  label: z.string().optional().describe('New name.'),
  kind: NodeKindSchema.optional().describe('New kind.'),
});

const ConnectArgs = z.object({
  source: NodeRef.describe('Id of the node the arrow starts from, like "n3".'),
  target: NodeRef.describe('Id of the node the arrow points to.'),
  label: z.string().optional().describe('What flows over the link, e.g. "events" (optional).'),
  mode: EdgeModeSchema.optional().describe(
    '"async" when the source does not wait (queue, events).',
  ),
});

const toParameters = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema: _, ...parameters } = z.toJSONSchema(schema);
  return parameters;
};

/** Looks at the draft board with the design rules (M1-30): what code can see every time. */
export const CHECK_DESIGN = 'check_design';
const CheckDesignArgs = z.object({});

/** A clarifying question for the user; it ends the answer (M1-32). */
export const ASK_USER = 'ask_user';
const AskUserArgs = z.object({
  question: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'One short question about what would change your advice (users, peak load, budget…).',
    ),
});

/**
 * The ReAct "done" (M1-32, replaces M1-31's no_change): every answer ends with a tool call, so the
 * loop never guesses from words whether the model meant to propose something.
 */
export const FINISH = 'finish';
const FinishArgs = z.object({
  summary: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'One or two sentences for the user: what you propose and why, or why nothing should change.',
    ),
});

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: CHECK_DESIGN,
    description:
      'Run the design checks on the board, including the changes you proposed so far: single points of failure, a missing cache or load balancer, duplicates, unconnected boxes. Call it first in a review, and again after your changes to see they fixed the findings.',
    parameters: toParameters(CheckDesignArgs),
  },
  {
    name: 'add_node',
    description:
      'Propose a new component on the board. Connect it in the same answer: you can call add_node and connect_nodes together.',
    parameters: toParameters(AddNodeArgs),
  },
  {
    name: 'update_node',
    description: 'Propose a new name or kind for an existing node.',
    parameters: toParameters(UpdateNodeArgs),
  },
  {
    name: 'connect_nodes',
    description: 'Propose an arrow between two nodes (existing, or added earlier in this answer).',
    parameters: toParameters(ConnectArgs),
  },
  {
    name: ASK_USER,
    description:
      'Ask the user one short question when the answer changes your advice (scale, read or write heavy, budget). It ends your answer: propose what you can first.',
    parameters: toParameters(AskUserArgs),
  },
  {
    name: FINISH,
    description:
      'End your answer. Call it last, after your proposed changes, or alone when nothing on the board should change. Every new box must have an arrow first.',
    parameters: toParameters(FinishArgs),
  },
];

const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name).join(', ');

/** New boxes in one proposal: a review proposes the few fixes that matter (owner's call, M1-24e). */
export const MAX_NEW_BOXES = 3;

/** The box already doing the job of the one the model wants to add, if any. */
const alreadyThere = (board: Board, kind: NodeKind, label: string) => {
  const job = oneOfAKindJob(kind, label);
  return job && board.nodes.find((n) => oneOfAKindJob(n.kind, n.label) === job);
};

type Planned = { op: AgentOp; aliases: Aliases; describe: (board: Board) => string };
type Plan = { ok: true; planned: Planned } | { ok: false; reply: string };

const refuse = (reply: string): Plan => ({ ok: false, reply });

const argsError = (tool: string, error: z.ZodError) =>
  `${tool}: ${error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Domain messages name real ids; the model only knows aliases. Whole ids only: an id like "a"
 * must not be replaced inside "api" or inside a word. */
const withAliases = (message: string, draft: Draft, aliases: Aliases) =>
  draft.board.nodes.reduce(
    (text, { id }) =>
      text.replace(
        new RegExp(`(?<![\\w-])${escapeRegExp(id)}(?![\\w-])`, 'g'),
        aliases.nodeAlias(id) ?? id,
      ),
    message,
  );

/** applyOps prefixes "Operation 1 (connect): " (which op) or "Operation 1 (label): " (which field,
 * for invalid values). The model knows which call it was; keep only a field name. */
const reasonOf = (error: { code: string; message: string }) => {
  const match = /^Operation \d+(?: \(([^)]*)\))?: ([\s\S]*)$/.exec(error.message);
  if (!match) return error.message;
  const [, inParens, rest = ''] = match;
  return error.code === 'INVALID_OP' && inParens ? `${inParens}: ${rest}` : rest;
};

const nodeLine = (board: Board, id: string, aliases: Aliases) => {
  const node = board.nodes.find((n) => n.id === id);
  return node
    ? `${aliases.nodeAlias(id) ?? '?'} [${node.kind}] ${JSON.stringify(node.label)}`
    : '?';
};

const plan = (draft: Draft, call: ToolCallInput, deps: ToolDeps): Plan => {
  const resolve = (ref: string): string | undefined => draft.aliases.nodeId(ref);
  const unknown = (ref: string) =>
    // A range, not the full list: on a big board the list would cost hundreds of tokens per mistake.
    refuse(`No node "${ref}". Node ids go from n1 to n${draft.aliases.nodeAliases().length}.`);

  switch (call.name) {
    case 'add_node': {
      const args = AddNodeArgs.safeParse(call.arguments);
      if (!args.success) return refuse(argsError(call.name, args.error));
      // The prompt asks for "one to three fixes"; measured, the model sometimes added 9. In code,
      // so it holds: the model is told why, and can still connect what it added.
      const added = draft.ops.filter((op) => op.op === 'addNode').length;
      if (added >= MAX_NEW_BOXES)
        return refuse(
          `A proposal has at most ${MAX_NEW_BOXES} new boxes, and this one has them. Keep the most important fixes: connect the boxes you added, then stop.`,
        );
      // The prompt says "never a second queue, cache or load balancer"; measured, the model did it
      // anyway. In code, with what to do instead (M1-29).
      const existing = alreadyThere(draft.board, args.data.kind, args.data.label);
      if (existing)
        return refuse(
          `There is already a ${oneOfAKindJob(existing.kind, existing.label) ?? existing.kind}: ${nodeLine(draft.board, existing.id, draft.aliases)}. Do not add a second one: connect to it, or rename it with update_node to show it does more (e.g. "Redis (cluster, 3 nodes)").`,
        );
      const near = args.data.near === undefined ? undefined : resolve(args.data.near);
      if (args.data.near !== undefined && near === undefined) return unknown(args.data.near);
      const nodeId = deps.newId();
      const aliases = draft.aliases.withNode(nodeId);
      const op: AgentOp = { op: 'addNode', nodeId, kind: args.data.kind, label: args.data.label };
      if (near !== undefined) op.near = near;
      return {
        ok: true,
        planned: { op, aliases, describe: (b) => `added ${nodeLine(b, nodeId, aliases)}` },
      };
    }
    case 'update_node': {
      const args = UpdateNodeArgs.safeParse(call.arguments);
      if (!args.success) return refuse(argsError(call.name, args.error));
      const nodeId = resolve(args.data.nodeId);
      if (nodeId === undefined) return unknown(args.data.nodeId);
      const op: AgentOp = { op: 'updateNode', nodeId };
      if (args.data.label !== undefined) op.label = args.data.label;
      if (args.data.kind !== undefined) op.kind = args.data.kind;
      const { aliases } = draft;
      return {
        ok: true,
        planned: { op, aliases, describe: (b) => `updated ${nodeLine(b, nodeId, aliases)}` },
      };
    }
    case 'connect_nodes': {
      const args = ConnectArgs.safeParse(call.arguments);
      if (!args.success) return refuse(argsError(call.name, args.error));
      const source = resolve(args.data.source);
      if (source === undefined) return unknown(args.data.source);
      const target = resolve(args.data.target);
      if (target === undefined) return unknown(args.data.target);
      const op: AgentOp = { op: 'connect', edgeId: deps.newId(), source, target };
      if (args.data.label !== undefined) op.label = args.data.label;
      if (args.data.mode !== undefined) op.mode = args.data.mode;
      const { aliases } = draft;
      const reply = `connected ${args.data.source} -> ${args.data.target}`;
      return { ok: true, planned: { op, aliases, describe: () => reply } };
    }
    default:
      return refuse(`Unknown tool "${call.name}". Available: ${TOOL_NAMES}.`);
  }
};

/** New boxes no arrow touches yet, in the order they were added. */
export const unconnectedNewBoxes = (ops: readonly AgentOp[]): string[] => {
  const linked = new Set(ops.flatMap((op) => (op.op === 'connect' ? [op.source, op.target] : [])));
  return ops.flatMap((op) => (op.op === 'addNode' && !linked.has(op.nodeId) ? [op.nodeId] : []));
};

/** `n3 "Orders API"`: how a tool result names a box. Labels quoted: they are user text. */
const boxName = (draft: Draft, id: string) => {
  const node = draft.board.nodes.find((n) => n.id === id);
  return `${draft.aliases.nodeAlias(id) ?? '?'} ${quote(node?.label ?? '')}`;
};

/** Rules about a link name it `from -> to`; the others list their boxes. */
const LINK_RULES = new Set<DesignFinding['rule']>(['no-load-balancer', 'no-cache']);

const findingsText = (findings: readonly DesignFinding[], draft: Draft) => {
  if (findings.length === 0)
    return 'No findings: the checks pass. Judge the rest against the requirements.';
  const lines = findings.map((f) => {
    const boxes = f.nodeIds
      .map((id) => boxName(draft, id))
      .join(LINK_RULES.has(f.rule) ? ' -> ' : ', ');
    return `- ${boxes}: ${f.problem}. Fix: ${f.fix}.`;
  });
  return [`${findings.length} finding${findings.length === 1 ? '' : 's'}:`, ...lines].join('\n');
};

/** Runs one tool call against the draft. Never throws: every failure is a reply for the model. */
export const runToolCall = (draft: Draft, call: ToolCallInput, deps: ToolDeps): ToolOutcome => {
  const refused = (reply: string): ToolOutcome => ({ draft, ok: false, reply });

  if (
    typeof call.arguments !== 'object' ||
    call.arguments === null ||
    Array.isArray(call.arguments)
  )
    return refused(
      `${call.name}: arguments must be a JSON object, e.g. {"kind": "cache", "label": "Redis"}.`,
    );
  // Looking, asking and ending change nothing: they work on a full proposal too.
  if (call.name === CHECK_DESIGN) {
    const args = CheckDesignArgs.safeParse(call.arguments);
    if (!args.success) return refused(argsError(call.name, args.error));
    return { draft, ok: true, reply: findingsText(checkDesign(draft.board), draft) };
  }
  if (call.name === ASK_USER) {
    const args = AskUserArgs.safeParse(call.arguments);
    if (!args.success) return refused(argsError(call.name, args.error));
    const end = { tool: ASK_USER, text: args.data.question } as const;
    return { draft, ok: true, reply: 'Asked: your answer ends here.', end };
  }
  if (call.name === FINISH) {
    const args = FinishArgs.safeParse(call.arguments);
    if (!args.success) return refused(argsError(call.name, args.error));
    // A floating box fixes nothing (M1-24e measured it often); refused here, as the tool's result.
    const floating = unconnectedNewBoxes(draft.ops);
    if (floating.length > 0)
      return refused(
        `finish refused: ${floating.map((id) => boxName(draft, id)).join(', ')} has no arrow yet. Connect each new box to the boxes it works with (connect_nodes), then call finish.`,
      );
    const end = { tool: FINISH, text: args.data.summary } as const;
    return { draft, ok: true, reply: 'Finished.', end };
  }
  if (draft.ops.length >= MAX_OPS_PER_PROPOSAL)
    return refused(
      `This proposal already has ${MAX_OPS_PER_PROPOSAL} changes; stop and summarise.`,
    );

  const planned = plan(draft, call, deps);
  if (!planned.ok) return refused(planned.reply);

  const { op, aliases, describe } = planned.planned;
  const applied = applyOps(draft.board, [op]);
  if (!applied.ok) {
    return refused(`${call.name} failed: ${withAliases(reasonOf(applied.error), draft, aliases)}`);
  }
  return {
    draft: { board: applied.value, aliases, ops: [...draft.ops, op] },
    ok: true,
    reply: describe(applied.value),
  };
};
