import { Panel, useStore } from '@xyflow/react';
import { IconButton } from '../../../../../core/ui/index.ts';
import { KIND_META, TOOLBAR_KINDS } from '../../../lib/kindMeta.ts';
import type { useBoardStore } from '../../../store/boardStore.ts';
import { spawnPosition, viewportCenter } from '../lib/spawnPosition.ts';

export type ToolbarProps = {
  store: typeof useBoardStore;
};

/** One button per kind; a click adds that kind in the middle of what you're looking at. Render inside <ReactFlow>. */
export function Toolbar({ store }: ToolbarProps) {
  const addNode = store((s) => s.addNode);
  const center = useStore((s) => viewportCenter({ width: s.width, height: s.height }, s.transform));

  return (
    <Panel position="top-left">
      <div
        role="toolbar"
        aria-label="Add a node"
        className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-1 shadow-sm"
      >
        {TOOLBAR_KINDS.map((kind) => (
          <IconButton
            key={kind}
            icon={KIND_META[kind].icon}
            label={`Add ${KIND_META[kind].name}`}
            variant="ghost"
            onClick={() => addNode(kind, spawnPosition(store.getState().board, center))}
          />
        ))}
      </div>
    </Panel>
  );
}
