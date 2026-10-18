// Public API of @designroom/diagram. Apps import only from here — never from React Flow or
// libavoid directly — so the engine behind it can change (ADR-004).
export { Diagram } from './components/Diagram.tsx';
export type { DiagramProps } from './components/Diagram.tsx';
export { DiagramPanel } from './components/DiagramPanel.tsx';
export type { DiagramPanelPosition, DiagramPanelProps } from './components/DiagramPanel.tsx';
export { useDiagramViewport } from './components/useDiagramViewport.ts';
export type { DiagramViewport } from './components/useDiagramViewport.ts';
export { NODE_SIZE } from './components/nodeSize.ts';
export { Shape } from './shapes/Shape.tsx';
export type { ShapeProps } from './shapes/Shape.tsx';
export { SHAPES } from './types.ts';
export type { DiagramEdge, DiagramNode, DiagramPosition, DiagramShape } from './types.ts';
export type { DiagramRouter, Route, RouterBox, RouterLink } from './router/types.ts';
