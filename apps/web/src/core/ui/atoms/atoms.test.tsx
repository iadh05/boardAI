import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Database } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';
import { Input } from './Input.tsx';
import { Spinner } from './Spinner.tsx';

describe('Button', () => {
  it('renders its children as the accessible name', () => {
    render(<Button>Add node</Button>);
    expect(screen.getByRole('button', { name: 'Add node' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Save
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('is type="button" by default, so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('can be reached with the keyboard and shows a focus ring', async () => {
    render(<Button>Save</Button>);

    await userEvent.tab();

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveFocus();
    expect(button.className).toContain('focus-visible:outline');
  });
});

describe('Input', () => {
  it('can be reached with the keyboard and shows a focus ring', async () => {
    render(<Input aria-label="Name" />);

    await userEvent.tab();

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveFocus();
    expect(input.className).toContain('focus-visible:outline');
  });
});

describe('Icon', () => {
  it('is hidden from screen readers when decorative', () => {
    const { container } = render(<Icon icon={Database} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is announced when it has a label', () => {
    render(<Icon icon={Database} label="Database" />);
    expect(screen.getByRole('img', { name: 'Database' })).toBeInTheDocument();
  });
});

describe('Spinner', () => {
  it('announces loading as a status', () => {
    render(<Spinner />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('accepts a more specific label', () => {
    render(<Spinner label="Waiting for the model" />);
    expect(screen.getByRole('status', { name: 'Waiting for the model' })).toBeInTheDocument();
  });
});
