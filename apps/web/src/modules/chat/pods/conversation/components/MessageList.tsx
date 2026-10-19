import { Spinner } from '../../../../../core/ui/index.ts';
import type { ChatEntry } from '../../../store/chatStore.ts';

export type MessageListProps = {
  messages: ChatEntry[];
  streaming: boolean;
  error: string | null;
};

/**
 * Molecule: the conversation as a log — screen readers announce new text politely. The answer
 * renders as it streams; before its first word, "Thinking…" (the first call can take ~20 s while
 * the model loads). Errors show inline, where the answer would have been.
 */
export function MessageList({ messages, streaming, error }: MessageListProps) {
  const last = messages.at(-1);
  // The answer exists from the start (empty) and fills as it streams.
  const waiting = streaming && last?.role === 'assistant' && last.content === '';
  const shown = messages.filter((m) => m.content !== '');

  return (
    <div role="log" aria-label="Conversation" className="flex flex-col gap-3 text-sm">
      {messages.length === 0 && !error && (
        <p className="text-muted">
          Ask the assistant to review your design — for example “Review my design”.
        </p>
      )}
      {shown.map((m) =>
        // 85 % width: a bubble never spans the panel, so who said what reads at a glance.
        m.role === 'user' ? (
          <p
            key={m.id}
            className="max-w-[85%] self-end rounded-lg bg-accent px-3 py-2 whitespace-pre-wrap text-accent-contrast"
          >
            {m.content}
          </p>
        ) : (
          <p
            key={m.id}
            className="max-w-[85%] self-start rounded-lg bg-canvas px-3 py-2 whitespace-pre-wrap text-ink"
          >
            {m.content}
          </p>
        ),
      )}
      {waiting && (
        <div className="flex items-center gap-2 self-start text-muted">
          <Spinner label="Thinking…" />
          <span aria-hidden="true">Thinking…</span>
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
