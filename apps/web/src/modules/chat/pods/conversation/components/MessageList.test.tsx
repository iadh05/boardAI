import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageList } from './MessageList.tsx';

// Agent V2 (AV2-09): while the specialists work, the user reads where they are (D6).

const waiting = [
  { id: 'm1', role: 'user' as const, content: 'Review my design' },
  { id: 'm2', role: 'assistant' as const, content: '' },
];

describe('MessageList', () => {
  it('shows the specialists’ progress instead of "Thinking…" while it lasts', () => {
    render(
      <MessageList
        messages={waiting}
        streaming
        error={null}
        progress="Data ✓ · Security running"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Data ✓ · Security running');
  });

  it('without progress, "Thinking…" as before', () => {
    render(<MessageList messages={waiting} streaming error={null} progress={null} />);
    expect(screen.getByRole('status')).toHaveTextContent(/thinking/i);
  });
});
