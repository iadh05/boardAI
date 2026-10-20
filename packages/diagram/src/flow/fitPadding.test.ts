import { describe, expect, it } from 'vitest';
import { fitPadding } from './fitPadding.ts';

// Rectangles relative to the pane's top-left corner, in screen pixels.
const pane = { width: 400, height: 800 };
const MARGIN = 24;

describe('fit padding around panels (found by hand, M2)', () => {
  it('nothing over the diagram: the same margin on every side', () => {
    expect(fitPadding(pane, [])).toEqual({
      top: MARGIN,
      right: MARGIN,
      bottom: MARGIN,
      left: MARGIN,
    });
  });

  it('a wide toolbar at the top: the diagram goes below it', () => {
    const toolbar = { x: 16, y: 16, width: 370, height: 300 };
    expect(fitPadding(pane, [toolbar])).toMatchObject({ top: 316 + MARGIN, left: MARGIN });
  });

  it('a tall panel on the left: the diagram goes to its right', () => {
    const wide = { width: 1200, height: 600 };
    const sidebar = { x: 0, y: 0, width: 300, height: 600 };
    expect(fitPadding(wide, [sidebar])).toMatchObject({ left: 300 + MARGIN, top: MARGIN });
  });

  it('narrow zoom buttons at the bottom left: padded on their cheaper side (the left)', () => {
    const zoomButtons = { x: 8, y: 680, width: 26, height: 110 };
    expect(fitPadding(pane, [zoomButtons])).toMatchObject({ bottom: MARGIN, left: MARGIN + 34 });
  });

  it('a panel covering almost everything: keeps a usable area rather than none', () => {
    const huge = { x: 0, y: 0, width: 400, height: 780 };
    const padding = fitPadding(pane, [huge]);
    expect(pane.height - padding.top - padding.bottom).toBeGreaterThanOrEqual(pane.height * 0.4);
  });
});
