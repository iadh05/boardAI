import { Diagram } from '@designroom/diagram';
import { canConnect, MAX_LABEL_LENGTH } from '@designroom/domain';
import { useMemo } from 'react';
import { useBoardStore } from '../../../store/boardStore.ts';
import { Toolbar } from '../../toolbar/index.ts';
import { toDiagram } from '../mappers/toDiagram.tsx';

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

  // useMemo: toDiagram previews the proposal with applyOps, and the diagram expects stable
  // arrays between renders.
  const { nodes, edges } = useMemo(() => toDiagram(board, proposal), [board, proposal]);

  return (
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
    >
      <Toolbar store={store} />
    </Diagram>
  );
}
