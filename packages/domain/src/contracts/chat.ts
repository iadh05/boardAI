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

/** POST /api/chat body. */
export const ChatRequestSchema = z.object({
  board: BoardSchema,
  messages: z.array(ChatMessageSchema).min(1).max(MAX_MESSAGES),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** One server-sent event of the /api/chat stream. Every stream ends with `done`. */
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('proposal'), proposal: ProposalSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done') }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;
