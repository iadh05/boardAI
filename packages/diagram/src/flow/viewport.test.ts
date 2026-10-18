import { describe, expect, it } from 'vitest';
import { viewportCenter } from './viewport.ts';

describe('viewportCenter', () => {
  it('is the middle of the pane when the view is not moved', () => {
    expect(viewportCenter({ width: 800, height: 600 }, [0, 0, 1])).toEqual({ x: 400, y: 300 });
  });

  it('follows panning and zoom (screen → diagram coordinates)', () => {
    // Panned right by 100 and down by 50, zoomed to 2×.
    expect(viewportCenter({ width: 800, height: 600 }, [100, 50, 2])).toEqual({ x: 150, y: 125 });
  });
});
