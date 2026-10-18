import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHAPES } from '../types.ts';
import { Shape } from './Shape.tsx';

const draw = (shape: (typeof SHAPES)[number], color = 'rgb(5, 150, 105)') =>
  render(<Shape shape={shape} width={160} height={64} color={color} />).container.querySelector(
    'svg',
  );

describe('Shape', () => {
  it.each(SHAPES)('draws a %s at the requested size', (shape) => {
    const svg = draw(shape);

    expect(svg).toHaveAttribute('width', '160');
    expect(svg).toHaveAttribute('height', '64');
    expect(svg?.querySelector('rect, path, ellipse, polygon')).not.toBeNull();
  });

  it('is decorative: the node, not the outline, carries the name', () => {
    expect(draw('rectangle')).toHaveAttribute('aria-hidden', 'true');
  });

  it('outlines in the given colour', () => {
    const outline = draw('cylinder', 'rgb(1, 2, 3)')?.querySelector('[stroke]');
    expect(outline).toHaveAttribute('stroke', 'rgb(1, 2, 3)');
  });

  it('draws the dashed shape (external systems) with a dashed outline', () => {
    expect(draw('dashed')?.querySelector('[stroke-dasharray]')).not.toBeNull();
  });

  it('a cylinder has a top rim, so it reads as storage', () => {
    expect(draw('cylinder')?.querySelectorAll('path')).toHaveLength(2);
  });
});
