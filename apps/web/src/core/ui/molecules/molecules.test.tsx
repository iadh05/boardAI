import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Card } from './Card.tsx';
import { IconButton } from './IconButton.tsx';
import { TextField } from './TextField.tsx';

describe('IconButton', () => {
  it('uses its label as the accessible name (the icon alone says nothing)', () => {
    render(<IconButton icon={Plus} label="Add node" />);
    expect(screen.getByRole('button', { name: 'Add node' })).toBeInTheDocument();
  });

  it('calls onClick', async () => {
    const onClick = vi.fn();
    render(<IconButton icon={Plus} label="Add node" onClick={onClick} />);

    await userEvent.click(screen.getByRole('button', { name: 'Add node' }));

    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('TextField', () => {
  it('links its label to the input', () => {
    render(<TextField label="Node name" />);
    expect(screen.getByRole('textbox', { name: 'Node name' })).toBeInTheDocument();
  });

  it('fires onChange while typing', async () => {
    const onChange = vi.fn();
    render(<TextField label="Node name" onChange={onChange} />);

    await userEvent.type(screen.getByRole('textbox', { name: 'Node name' }), 'API');

    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('describes the input with its hint', () => {
    render(<TextField label="Node name" hint="Up to 100 characters" />);
    expect(screen.getByRole('textbox', { name: 'Node name' })).toHaveAccessibleDescription(
      'Up to 100 characters',
    );
  });

  it('marks the input invalid and describes it with the error', () => {
    render(<TextField label="Node name" error="Name is required" />);

    const input = screen.getByRole('textbox', { name: 'Node name' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Name is required');
  });

  it('shows the hint and the error together, both describing the input', () => {
    render(<TextField label="Node name" hint="Up to 100 characters" error="Too long" />);
    expect(screen.getByRole('textbox', { name: 'Node name' })).toHaveAccessibleDescription(
      'Too long Up to 100 characters',
    );
  });

  it("keeps the caller's aria-describedby and still links the error", () => {
    render(
      <>
        <p id="extra-help">Shown on the canvas</p>
        <TextField label="Node name" error="Too long" aria-describedby="extra-help" />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Node name' })).toHaveAccessibleDescription(
      'Shown on the canvas Too long',
    );
  });

  it('stays invalid even if the caller passes aria-invalid={false} with an error', () => {
    render(<TextField label="Node name" error="Too long" aria-invalid={false} />);
    expect(screen.getByRole('textbox', { name: 'Node name' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

describe('Card', () => {
  it('renders its title and content', () => {
    render(<Card title="Proposal">Add a cache</Card>);

    expect(screen.getByText('Proposal')).toBeInTheDocument();
    expect(screen.getByText('Add a cache')).toBeInTheDocument();
  });
});
