import { DiagramPanel, NODE_SIZE, useDiagramViewport } from '@designroom/diagram';
import { KIND_DEFAULT_LABEL, type NodeKind } from '@designroom/domain';
import { SquareDashed } from 'lucide-react';
import { useRef } from 'react';
import { ToolButton } from '../../../../../core/ui/index.ts';
import { KIND_ICON, TOOLBAR_KINDS } from '../../../lib/kindAppearance.ts';
import type { useBoardStore } from '../../../store/boardStore.ts';
import { canvasHint } from '../lib/canvasHint.ts';
import { spawnPosition } from '../lib/spawnPosition.ts';

/** A new zone: room for a few boxes; the user resizes it from its corner. */
const NEW_ZONE_SIZE = { width: 520, height: 300 };
const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;

export type ToolbarProps = {
  store: typeof useBoardStore;
};

/**
 * One button per kind; a click adds that kind in the middle of what you're looking at, never
 * under the toolbar itself. Below it, until the first arrow, a tip for the next step — here and
 * not over the canvas, so it never covers a box. Render inside <Diagram>.
 */
export function Toolbar({ store }: ToolbarProps) {
  const hint = store((s) =>
    canvasHint({ nodes: s.board.nodes.length, edges: s.board.edges.length }),
  );
  const addNode = store((s) => s.addNode);
  const startEditing = store((s) => s.startEditing);
  const addZone = store((s) => s.addZone);
  // Reads the view at click time, so the toolbar never re-renders on pan or zoom.
  const viewport = useDiagramViewport();
  // The panel (buttons and hint) hides part of the canvas: new boxes don't go there.
  const panel = useRef<HTMLDivElement>(null);

  const add = (kind: NodeKind) => {
    const id = addNode(
      kind,
      spawnPosition(
        store.getState().board,
        viewport.center(),
        NODE_SIZE,
        viewport.bounds(),
        panel.current ? [viewport.coveredBy(panel.current)] : [],
      ),
    );
    // A Custom node is only as good as its label: ask for it straight away.
    if (id && kind === 'custom') startEditing(id);
  };

  /** A zone centred on the view, drawn behind any boxes there; its title opens for naming. */
  const addZoneHere = () => {
    const center = viewport.center();
    addZone(
      { x: snap(center.x - NEW_ZONE_SIZE.width / 2), y: snap(center.y - NEW_ZONE_SIZE.height / 2) },
      NEW_ZONE_SIZE,
    );
  };

  return (
    <DiagramPanel position="top-left">
      <div ref={panel} className="flex flex-col items-start gap-2">
        <div
          role="toolbar"
          aria-label="Add a node"
          className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1 shadow-sm"
        >
          {TOOLBAR_KINDS.map((kind) => (
            <ToolButton
              key={kind}
              icon={KIND_ICON[kind]}
              caption={KIND_DEFAULT_LABEL[kind]}
              label={`Add ${KIND_DEFAULT_LABEL[kind]}`}
              onClick={() => add(kind)}
            />
          ))}
          <span
            role="separator"
            aria-orientation="vertical"
            className="mx-1 w-px self-stretch bg-line"
          />
          <ToolButton icon={SquareDashed} caption="Zone" label="Add Zone" onClick={addZoneHere} />
        </div>
        {hint && (
          // w-0 + min-w-full: as wide as the toolbar, never wider. min-h-10: room for two lines
          // from the start, so a longer tip later doesn't grow the panel over a box.
          <p className="min-h-10 w-0 min-w-full rounded-md bg-surface px-2 py-1 text-xs text-muted shadow-sm">
            {hint}
          </p>
        )}
      </div>
    </DiagramPanel>
  );
}
