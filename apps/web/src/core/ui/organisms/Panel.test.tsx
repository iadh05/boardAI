import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel.tsx';

describe('Panel', () => {
  it('is a region named by its title', () => {
    render(<Panel title="Assistant">body</Panel>);

    expect(screen.getByRole('region', { name: 'Assistant' })).toHaveTextContent('body');
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument();
  });

  it('renders the footer slot when given', () => {
    render(
      <Panel title="Assistant" footer={<p>footer content</p>}>
        body
      </Panel>,
    );

    expect(screen.getByText('footer content')).toBeInTheDocument();
  });

  it('renders no footer element without a footer', () => {
    const { container } = render(<Panel title="Assistant">body</Panel>);
    expect(container.querySelector('footer')).toBeNull();
  });
});
