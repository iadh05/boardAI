import { Diagram } from '@designroom/diagram';
import {
  canConnect,
  MAX_EDGE_LABEL_LENGTH,
  MAX_LABEL_LENGTH,
  MIN_ZONE_SIZE,
} from '@designroom/domain';
import { useMemo, useState } from 'react';
import { useBoardStore } from '../../../store/boardStore.ts';
import { Toolbar } from '../../toolbar/index.ts';
import { toDiagram } from '../mappers/toDiagram.tsx';

/** The overview map earns its space only once the board outgrows the view. */
const MINIMAP_FROM = 8;

export type CanvasProps = {
  /** The board store to show; the app's store by default, a test store in tests. */
  store?: typeof useBoardStore;
};

/** The diagram area: @designroom/diagram, driven by the board store (ADR-004). */
export function Canvas({ store = useBoardStore }: CanvasProps) {
  const board = store((s) => s.board);
  const proposal = store((s) => s.proposal);
  const editingNodeId = store((s) => s.editingNodeId);
  const moveNode = store((s) => s.moveNode);
  const connect = store((s) => s.connect);
  const removeElements = store((s) => s.removeElements);
  const startEditing = store((s) => s.startEditing);
  const stopEditing = store((s) => s.stopEditing);
  const renameNode = store((s) => s.renameNode);
  const labelEdge = store((s) => s.labelEdge);
  const setEdgeMode = store((s) => s.setEdgeMode);
  const editingZoneId = store((s) => s.editingZoneId);
  const moveZone = store((s) => s.moveZone);
  const resizeZone = store((s) => s.resizeZone);
  const renameZone = store((s) => s.renameZone);
  const stopEditingZone = store((s) => s.stopEditingZone);
  const startEditingZone = store((s) => s.startEditingZone);
  // Which arrow is being edited: view state only the canvas needs (frontend rules: State).
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);

  // useMemo: toDiagram previews the proposal with applyOps, and the diagram expects stable
  // arrays between renders.
  const { nodes, edges, zones } = useMemo(() => toDiagram(board, proposal), [board, proposal]);

  return (
    <div className="relative h-full">
      <Diagram
        nodes={nodes}
        edges={edges}
        ariaLabel="Diagram"
        // The same domain rule twice, on purpose: while dragging, canConnect only lights up the
        // drop target (UX); on drop, the store's connect checks it again before changing the board.
        canConnect={(source, target) => canConnect(store.getState().board, source, target).ok}
        onConnect={(source, target) => {
          connect(source, target);
        }}
        onNodeMove={moveNode}
        onDelete={removeElements}
        editingNodeId={editingNodeId}
        maxLabelLength={MAX_LABEL_LENGTH}
        onEditStart={startEditing}
        onLabelCommit={renameNode}
        onEditEnd={stopEditing}
        editingEdgeId={editingEdgeId}
        maxEdgeLabelLength={MAX_EDGE_LABEL_LENGTH}
        dashedLabel="Async"
        onEdgeEditStart={setEditingEdgeId}
        onEdgeLabelCommit={labelEdge}
        // Dashed on the diagram = an async call in the board model.
        onEdgeDashedChange={(id, dashed) => setEdgeMode(id, dashed ? 'async' : 'sync')}
        onEdgeEditEnd={() => setEditingEdgeId(null)}
        minimap={nodes.length >= MINIMAP_FROM}
        zones={zones}
        minZoneSize={MIN_ZONE_SIZE}
        editingZoneId={editingZoneId}
        onZoneMove={moveZone}
        onZoneResize={resizeZone}
        onZoneEditStart={startEditingZone}
        onZoneLabelCommit={renameZone}
        onZoneEditEnd={stopEditingZone}
      >
        <Toolbar store={store} />
      </Diagram>
      {nodes.length === 0 && (
        // Over the canvas, ignoring the pointer, so it never blocks panning or the toolbar.
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted">
          Add a component from the toolbar to start your design.
        </p>
      )}
      {nodes.length >= 2 && edges.length === 0 && (
        // The connection dots only show on hover: say how to connect until the first arrow.
        <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-muted">
          Drag from a dot on the side of a box to another box to connect them.
        </p>
      )}
    </div>
  );
}
