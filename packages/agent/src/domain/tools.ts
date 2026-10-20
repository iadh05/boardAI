import type { ToolDefinition } from '@designroom/ai-gateway';
import {
  applyOps,
  EdgeModeSchema,
  MAX_OPS_PER_PROPOSAL,
  NodeKindSchema,
  type AgentOp,
  type Board,
} from '@designroom/domain';
import { z } from 'zod';
import { createAliases, type Aliases } from './aliases.ts';

// The agent's tools (architecture §7): add_node, update_node, connect_nodes — and no delete.
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
export type ToolOutcome = { draft: Draft; ok: boolean; reply: string };
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

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'add_node',
    description: 'Propose a new component on the board.',
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
];

const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name).join(', ');

/** New boxes in one proposal: a review proposes the few fixes that matter (owner's call, M1-24e). */
export const MAX_NEW_BOXES = 3;

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
