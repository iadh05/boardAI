import { canConnect } from '@designroom/domain';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type OnConnect,
  type OnDelete,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';
import { useBoardStore } from '../../../store/boardStore.ts';
import { BoardStoreContext } from '../../../store/boardStoreContext.ts';
import { GhostNode, SystemNode } from '../../node/index.ts';
import { Toolbar } from '../../toolbar/index.ts';
import type { FlowNode } from '../../../lib/flowTypes.ts';
import { mergeFlowEdges } from '../lib/edgeChanges.ts';
import { canvasChanges, commitNodeChanges, mergeFlowNodes } from '../lib/nodeChanges.ts';
import { toFlow } from '../mappers/toFlow.ts';

// Defined once, outside any component: a new object each render would remount every node.
const nodeTypes: NodeTypes = { system: SystemNode, ghost: GhostNode };
const FIT_VIEW = { maxZoom: 1 };
const DELETE_KEYS = ['Backspace', 'Delete'];

export type CanvasProps = {
  /** The board store to show; the app's store by default, a test store in tests. */
  store?: typeof useBoardStore;
};

/** The diagram area: React Flow, driven by the board store. */
export function Canvas({ store = useBoardStore }: CanvasProps) {
  const board = store((s) => s.board);
  const proposal = store((s) => s.proposal);
  const moveNode = store((s) => s.moveNode);
  const startEditing = store((s) => s.startEditing);
  const connect = store((s) => s.connect);
  const removeElements = store((s) => s.removeElements);

  // useMemo: toFlow previews the proposal with applyOps — don't redo that on every render.
  const flow = useMemo(() => toFlow(board, proposal), [board, proposal]);

  // Canvas-local copy of the nodes: React Flow updates it during drags, selection and
  // measuring; the store's version is merged in whenever the store changes ("adjust state
  // when a prop changes" — React docs). Avoids rebuilding the board on every drag frame.
  const [nodes, setNodes] = useState<FlowNode[]>(flow.nodes);
  const [edges, setEdges] = useState<Edge[]>(flow.edges);
  const [mergedFrom, setMergedFrom] = useState(flow);
  if (mergedFrom !== flow) {
    setMergedFrom(flow);
    setNodes((current) => mergeFlowNodes(flow.nodes, current));
    setEdges((current) => mergeFlowEdges(flow.edges, current));
  }

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((current) => applyNodeChanges(canvasChanges(changes), current));
      commitNodeChanges(changes, { moveNode });
    },
    [moveNode],
  );

  // Edges: the canvas keeps only selection; the store decides what exists.
  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(canvasChanges(changes), current));
  };

  // The same domain rule twice, on purpose: while dragging, isValidConnection only colours the
  // drop target (UX); on drop, the store's connect checks it again before changing the board.
  const isValidConnection: IsValidConnection = ({ source, target }) =>
    canConnect(store.getState().board, source, target).ok;
  const onConnect: OnConnect = ({ source, target }) => {
    connect(source, target);
  };

  // Delete/Backspace on a selection: React Flow lists the nodes and every edge to remove (incl.
  // edges attached to those nodes); the store removes them in one update.
  const onDelete: OnDelete<FlowNode> = ({ nodes: removedNodes, edges: removedEdges }) => {
    removeElements(
      removedNodes.map((n) => n.id),
      removedEdges.map((e) => e.id),
    );
  };

  // Rename triggers live here, not in SystemNode: React Flow's wrapper around each node is
  // the element that is focused and double-clicked, and its events don't reach the node inside.
  const onNodeDoubleClick: NodeMouseHandler<FlowNode> = (_, node) => {
    if (node.type === 'system') startEditing(node.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (event.key !== 'Enter' || !(target instanceof HTMLElement)) return;
    if (!target.classList.contains('react-flow__node-system')) return;
    if (target.dataset.id) startEditing(target.dataset.id);
  };

  return (
    // Node components (rendered by React Flow) find this store through the context.
    <BoardStoreContext value={store}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDelete={onDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        onKeyDown={onKeyDown}
        deleteKeyCode={DELETE_KEYS}
        // On an empty board the fit happens when the first node appears — without a cap it zooms to 2×.
        fitView
        fitViewOptions={FIT_VIEW}
        aria-label="Diagram"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} />
        <Controls />
        <MiniMap pannable zoomable />
        <Toolbar store={store} />
      </ReactFlow>
    </BoardStoreContext>
  );
}
