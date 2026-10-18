import { DiagramPanel, NODE_SIZE, useDiagramViewport } from '@designroom/diagram';
import { KIND_DEFAULT_LABEL, type NodeKind } from '@designroom/domain';
import { SquareDashed } from 'lucide-react';
import { ToolButton } from '../../../../../core/ui/index.ts';
import { KIND_ICON, TOOLBAR_KINDS } from '../../../lib/kindAppearance.ts';
import type { useBoardStore } from '../../../store/boardStore.ts';
import { spawnPosition } from '../lib/spawnPosition.ts';

/** A new zone: room for a few boxes; the user resizes it from its corner. */
const NEW_ZONE_SIZE = { width: 520, height: 300 };
const GRID = 20;
const snap = (v: number) => Math.round(v / GRID) * GRID;

export type ToolbarProps = {
  store: typeof useBoardStore;
};

/** One button per kind; a click adds that kind in the middle of what you're looking at. Render inside <Diagram>. */
export function Toolbar({ store }: ToolbarProps) {
  const addNode = store((s) => s.addNode);
  const startEditing = store((s) => s.startEditing);
  const addZone = store((s) => s.addZone);
  // Reads the view at click time, so the toolbar never re-renders on pan or zoom.
  const viewport = useDiagramViewport();

  const add = (kind: NodeKind) => {
    const id = addNode(
      kind,
      spawnPosition(store.getState().board, viewport.center(), NODE_SIZE, viewport.bounds()),
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
    </DiagramPanel>
  );
}
