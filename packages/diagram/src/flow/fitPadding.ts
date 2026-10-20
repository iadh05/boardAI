// Fitting the view around what floats over the diagram (M2, found by hand): React Flow fits to
// the whole pane, so boxes ended up under the app's toolbar while the rest of the pane was empty.

export type Size = { width: number; height: number };
/** A rectangle relative to the pane's top-left corner, in screen pixels. */
export type ScreenRect = { x: number; y: number; width: number; height: number };
export type Padding = { top: number; right: number; bottom: number; left: number };

/** Space kept between the diagram and the pane's edges (or a panel). */
const MARGIN = 24;
/** Never shrink the diagram's area below this share of the pane on either axis. */
const MIN_SHARE = 0.4;

/**
 * Padding for a fit that keeps clear of `panels`. Each panel is avoided on its cheapest side —
 * the one that leaves the largest area: a wide toolbar at the top pads the top, a tall sidebar
 * pads the left. Padding per side is the largest any panel needs, plus a margin.
 */
export const fitPadding = (pane: Size, panels: readonly ScreenRect[]): Padding => {
  const pad = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const r of panels) {
    const candidates: [keyof Padding, number][] = [
      ['top', r.y + r.height],
      ['left', r.x + r.width],
      ['bottom', pane.height - r.y],
      ['right', pane.width - r.x],
    ];
    const area = (side: keyof Padding, value: number) => {
      const next = { ...pad, [side]: Math.max(pad[side], value) };
      return (
        Math.max(0, pane.width - next.left - next.right) *
        Math.max(0, pane.height - next.top - next.bottom)
      );
    };
    const [side, value] = candidates.reduce((best, c) =>
      area(c[0], c[1]) > area(best[0], best[1]) ? c : best,
    );
    pad[side] = Math.max(pad[side], value);
  }

  const result = {
    top: pad.top + MARGIN,
    right: pad.right + MARGIN,
    bottom: pad.bottom + MARGIN,
    left: pad.left + MARGIN,
  };
  // A panel covering nearly everything: fit to the pane on that axis rather than to nothing.
  if (pane.height - result.top - result.bottom < pane.height * MIN_SHARE)
    Object.assign(result, { top: MARGIN, bottom: MARGIN });
  if (pane.width - result.left - result.right < pane.width * MIN_SHARE)
    Object.assign(result, { left: MARGIN, right: MARGIN });
  return result;
};
