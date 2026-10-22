import { Spinner } from '../../../../../core/ui/index.ts';
import type { ChatEntry } from '../../../store/chatStore.ts';

export type MessageListProps = {
  messages: ChatEntry[];
  streaming: boolean;
  error: string | null;
  /** Agent V2's specialists at work (AV2-09): shown instead of "Thinking…". */
  progress?: string | null;
};

// 85 % width: a bubble never spans the panel, so who said what reads at a glance.
const BUBBLE: Record<ChatEntry['role'], string> = {
  user: 'self-end bg-accent text-accent-contrast',
  assistant: 'self-start bg-canvas text-ink',
};

/**
 * Molecule: the conversation as a log. Busy while an answer streams, so screen readers read the
 * finished answer once instead of every token. Before its first word, "Thinking…" (the first call
 * can take ~20 s while the model loads). Errors show inline, where the answer would have been.
 */
export function MessageList({ messages, streaming, error, progress = null }: MessageListProps) {
  const last = messages.at(-1);
  // The answer exists from the start (empty) and fills as it streams.
  const waiting = streaming && last?.role === 'assistant' && last.content === '';

  return (
    <div
      role="log"
      aria-label="Conversation"
      aria-busy={streaming}
      className="flex flex-col gap-3 text-sm"
    >
      {messages.length === 0 && !error && (
        <p className="text-muted">
          Ask the assistant to review your design — for example “Review my design”.
        </p>
      )}
      {messages
        .filter((m) => m.content !== '')
        .map((m) =>
          m.note ? (
            // The app speaking for the user ("Accepted: …"): a quiet line, not a bubble.
            <p key={m.id} className="self-center text-xs text-muted">
              {m.content}
            </p>
          ) : (
            <p
              key={m.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap ${BUBBLE[m.role]}`}
            >
              {m.content}
            </p>
          ),
        )}
      {waiting && (
        <div className="flex items-center gap-2 self-start text-muted">
          <Spinner label={progress ?? 'Thinking…'} />
          <span aria-hidden="true">{progress ?? 'Thinking…'}</span>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger px-3 py-2 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
