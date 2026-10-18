import type { NodeKind } from '@designroom/domain';
import type { Edge, Node } from '@xyflow/react';

// React Flow node/edge types of the board module. Used by the canvas pod (toFlow) and the node
// pod (SystemNode, GhostNode), so they live at module level (promotion on the 2nd use) — this
// also keeps the two pods from importing each other.

export type BoardNodeData = { kind: NodeKind; label: string };
export type SystemFlowNode = Node<BoardNodeData, 'system'>;
export type GhostFlowNode = Node<BoardNodeData, 'ghost'>;
export type FlowNode = SystemFlowNode | GhostFlowNode;

export type FlowGraph = { nodes: FlowNode[]; edges: Edge[] };
