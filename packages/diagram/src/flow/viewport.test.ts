import { describe, expect, it } from 'vitest';
import { screenRectToDiagram, viewportBounds, viewportCenter } from './viewport.ts';

describe('viewportCenter', () => {
  it('is the middle of the pane when the view is not moved', () => {
    expect(viewportCenter({ width: 800, height: 600 }, [0, 0, 1])).toEqual({ x: 400, y: 300 });
  });

  it('follows panning and zoom (screen → diagram coordinates)', () => {
    // Panned right by 100 and down by 50, zoomed to 2×.
    expect(viewportCenter({ width: 800, height: 600 }, [100, 50, 2])).toEqual({ x: 150, y: 125 });
  });
});

describe('viewportBounds', () => {
  it('is the pane itself when the view is not moved', () => {
    expect(viewportBounds({ width: 800, height: 600 }, [0, 0, 1])).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it('follows panning and zoom (what the user sees, in diagram coordinates)', () => {
    expect(viewportBounds({ width: 800, height: 600 }, [100, 50, 2])).toEqual({
      x: -50,
      y: -25,
      width: 400,
      height: 300,
    });
  });
});

describe('screenRectToDiagram', () => {
  it('is the same rectangle when the view is not moved', () => {
    expect(screenRectToDiagram({ x: 10, y: 20, width: 300, height: 100 }, [0, 0, 1])).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 100,
    });
  });

  it('follows panning and zoom: what part of the diagram an overlay hides', () => {
    // Panned by (100, 50), zoomed ×2: the overlay at pane (10, 20), 300×100 hides less diagram.
    expect(screenRectToDiagram({ x: 10, y: 20, width: 300, height: 100 }, [100, 50, 2])).toEqual({
      x: -45,
      y: -15,
      width: 150,
      height: 50,
    });
  });
});
