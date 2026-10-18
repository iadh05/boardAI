// Public API of @designroom/diagram. Apps import only from here — never from React Flow or
// libavoid directly, so the engine behind it can change (ADR-004).
export { Shape } from './shapes/Shape.tsx';
export type { ShapeProps } from './shapes/Shape.tsx';
export { SHAPES } from './types.ts';
export type { DiagramEdge, DiagramNode, DiagramPosition, DiagramShape } from './types.ts';
