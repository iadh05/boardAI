import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.tsx';

function Crashes(): never {
  throw new Error('render bug');
}

// React logs caught render errors to the console; keep the test output readable.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows its children while nothing breaks', () => {
    render(
      <ErrorBoundary fallback={<p>Broken</p>}>
        <p>Fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Fine')).toBeInTheDocument();
  });

  it('shows the fallback instead of a blank page when a child crashes, and reports it', () => {
    const onError = vi.fn<(error: unknown) => void>();

    render(
      <ErrorBoundary fallback={<p role="alert">The assistant crashed.</p>} onError={onError}>
        <Crashes />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The assistant crashed.');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'render bug' }));
  });
});
