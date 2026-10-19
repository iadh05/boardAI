import { SendHorizontal, Square } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { IconButton, Input } from '../../../../../core/ui/index.ts';

export type MessageInputProps = {
  /** An answer is streaming: typing waits, Stop replaces Send. */
  streaming: boolean;
  /** Resolves to text to show again when the message was refused (fix it and resend). */
  onSend: (text: string) => Promise<string | null>;
  onStop: () => void;
};

/** Molecule: the chat's input line. Enter sends; the text is the view's own state. */
export function MessageInput({ streaming, onSend, onStop }: MessageInputProps) {
  const [text, setText] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (streaming || text.trim() === '') return;
    setText('');
    const giveBack = await onSend(text);
    if (giveBack) setText(giveBack);
  };

  return (
    <form className="flex gap-2" onSubmit={(e) => void submit(e)}>
      <Input
        aria-label="Message the assistant"
        placeholder="Ask about your design…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={streaming}
        autoComplete="off"
      />
      {streaming ? (
        <IconButton icon={Square} label="Stop" onClick={onStop} />
      ) : (
        <IconButton
          icon={SendHorizontal}
          label="Send"
          type="submit"
          variant="primary"
          disabled={text.trim() === ''}
        />
      )}
    </form>
  );
}
