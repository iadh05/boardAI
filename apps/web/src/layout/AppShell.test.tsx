import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.tsx';

describe('AppShell', () => {
  it('shows the product name as the page heading', () => {
    render(<AppShell canvas={null} sidePanel={null} />);

    expect(screen.getByRole('heading', { level: 1, name: 'DesignRoom' })).toBeInTheDocument();
  });

  it('puts the canvas in the main region', () => {
    render(<AppShell canvas={<p>canvas content</p>} sidePanel={null} />);

    expect(screen.getByRole('main')).toHaveTextContent('canvas content');
  });

  it('puts the side panel in a labelled complementary region', () => {
    render(<AppShell canvas={null} sidePanel={<p>chat content</p>} />);

    expect(screen.getByRole('complementary', { name: 'Assistant' })).toHaveTextContent(
      'chat content',
    );
  });

  it('puts the canvas first, so on a phone (stacked) the diagram comes before the panel', () => {
    render(<AppShell canvas={<p>canvas</p>} sidePanel={<p>chat</p>} />);
    const main = screen.getByRole('main');
    const aside = screen.getByRole('complementary', { name: 'Assistant' });
    expect(main.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
