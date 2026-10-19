/**
 * The tip shown under the toolbar until the board has its first arrow. Always some text until
 * then, so the panel keeps its size: a hint that appeared later would cover the boxes placed
 * just below the toolbar. Once it goes, the panel only shrinks — it never covers anything.
 */
export const canvasHint = ({ nodes, edges }: { nodes: number; edges: number }): string | null => {
  if (edges > 0) return null;
  if (nodes === 0) return 'Add a component from the toolbar to start your design.';
  if (nodes === 1) return 'Add another component, then drag from a dot on a box to connect them.';
  // The connection dots only show on hover: say how to connect until the first arrow.
  return 'Drag from a dot on the side of a box to another box to connect them.';
};
