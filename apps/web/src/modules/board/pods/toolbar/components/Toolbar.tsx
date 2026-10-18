import { KIND_DEFAULT_LABEL, type NodeKind } from '@designroom/domain';
import { Panel, useStoreApi } from '@xyflow/react';
import { IconButton } from '../../../../../core/ui/index.ts';
import { KIND_ICON, TOOLBAR_KINDS } from '../../../lib/kindIcon.ts';
import type { useBoardStore } from '../../../store/boardStore.ts';
import { spawnPosition, viewportCenter } from '../lib/spawnPosition.ts';

export type ToolbarProps = {
  store: typeof useBoardStore;
};

/** One button per kind; a click adds that kind in the middle of what you're looking at. Render inside <ReactFlow>. */
export function Toolbar({ store }: ToolbarProps) {
  const addNode = store((s) => s.addNode);
  // Read the viewport at click time: subscribing would re-render the toolbar on every pan/drag frame.
  const flow = useStoreApi();

  const add = (kind: NodeKind) => {
    const { width, height, transform } = flow.getState();
    const center = viewportCenter({ width, height }, transform);
    addNode(kind, spawnPosition(store.getState().board, center));
  };

  return (
    <Panel position="top-left">
      <div
        role="toolbar"
        aria-label="Add a node"
        className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1 shadow-sm"
      >
        {TOOLBAR_KINDS.map((kind) => (
          <IconButton
            key={kind}
            icon={KIND_ICON[kind]}
            label={`Add ${KIND_DEFAULT_LABEL[kind]}`}
            variant="ghost"
            onClick={() => add(kind)}
          />
        ))}
      </div>
    </Panel>
  );
}
