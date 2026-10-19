import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProposalCard } from './ProposalCard.tsx';

const summary = 'Add cache "Redis"; connect "API" → "Redis"';

describe('ProposalCard', () => {
  it('shows what the AI proposes, as a named region with Accept and Reject', async () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    render(<ProposalCard summary={summary} error={null} onAccept={onAccept} onReject={onReject} />);

    const card = screen.getByRole('region', { name: 'Proposed change' });
    expect(card).toHaveTextContent(summary);

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onAccept).toHaveBeenCalledOnce();
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('says why accepting failed, and still lets the user reject', () => {
    render(
      <ProposalCard
        summary={summary}
        error="This proposal is out of date: No node with id …"
        onAccept={() => {}}
        onReject={() => {}}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/out of date/);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });
});
