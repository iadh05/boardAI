import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';

describe('App', () => {
  it('renders the shell with the canvas and assistant placeholders', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'DesignRoom' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent(/canvas/i);
    expect(screen.getByRole('complementary', { name: 'Assistant' })).toHaveTextContent(
      /assistant/i,
    );
  });
});
