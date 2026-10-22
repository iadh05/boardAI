import { z } from 'zod';
import { ProposalSchema } from '../board/agentOps.ts';
import { BoardSchema } from '../board/board.ts';

// The chat API between the web app and the server (architecture §4.4), defined before either
// side exists. Both sides parse with these schemas: the server its input, the browser each event.

/** Longest single chat message, in characters. */
export const MAX_MESSAGE_LENGTH = 4000;
/** Most messages sent with one request (the server's chatPolicy may set a lower limit). */
export const MAX_MESSAGES = 50;

export const ChatMessageSchema = z.object({
  // No 'system' role: the server owns the system prompt; a client must not be able to send one.
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/**
 * Largest board the chat accepts: the whole board goes into the model's prompt on every request,
 * so it must stay small enough for a local model's context. (The editor itself has no such limit.)
 */
export const MAX_CHAT_BOARD_NODES = 150;
export const MAX_CHAT_BOARD_EDGES = 300;
export const MAX_CHAT_BOARD_ZONES = 50;

/** POST /api/chat body. */
export const ChatRequestSchema = z.object({
  board: BoardSchema.refine(
    (b) =>
      b.nodes.length <= MAX_CHAT_BOARD_NODES &&
      b.edges.length <= MAX_CHAT_BOARD_EDGES &&
      (b.zones?.length ?? 0) <= MAX_CHAT_BOARD_ZONES,
    {
      message: `The board is too large for the assistant (max ${MAX_CHAT_BOARD_NODES} nodes, ${MAX_CHAT_BOARD_EDGES} edges, ${MAX_CHAT_BOARD_ZONES} zones)`,
    },
  ),
  messages: z.array(ChatMessageSchema).min(1).max(MAX_MESSAGES),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** One server-sent event of the /api/chat stream. Every stream ends with `done`. */
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('proposal'), proposal: ProposalSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done') }),
  // Agent V2 (AV2-09): where the specialists are, shown while they work (D6).
  z.object({ type: z.literal('progress'), text: z.string().max(300) }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

/**
 * Accept or Reject on a proposal, sent back as feedback on the review's trace (M1-26c). The ids are
 * OpenTelemetry's hex ids, checked strictly: they go into a request to Phoenix.
 */
export const ProposalFeedbackSchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  spanId: z.string().regex(/^[0-9a-f]{16}$/),
  verdict: z.enum(['accepted', 'rejected']),
});
export type ProposalFeedback = z.infer<typeof ProposalFeedbackSchema>;
