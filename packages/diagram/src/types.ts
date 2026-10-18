import type { ReactNode } from 'react';

// The package's public vocabulary: boxes, arrows and zones — nothing about DesignRoom.
// Apps map their own concepts (e.g. "a database") onto these.

/** Outlines a node can have, in the draw.io / cloud-architecture style. */
export const SHAPES = [
  'rectangle',
  'rounded',
  'cylinder',
  'queue',
  'hexagon',
  'ellipse',
  'device',
  'dashed',
] as const;
export type DiagramShape = (typeof SHAPES)[number];

export type DiagramPosition = { x: number; y: number };

export type DiagramNode = {
  id: string;
  label: string;
  /** Top-left corner, in diagram coordinates. */
  position: DiagramPosition;
  shape?: DiagramShape;
  /** Any CSS colour (e.g. a theme variable): outline, tint and icon. */
  color?: string;
  /** A small icon drawn at the left of the label (decorative). */
  icon?: ReactNode;
  /** Spoken name of what the node is ("Database"), when the label says something else. */
  description?: string;
  /** A proposal: drawn faded and dashed; can't be moved, connected or deleted. */
  ghost?: boolean;
};

export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** Asynchronous or optional links, drawn dashed. */
  dashed?: boolean;
  /** A proposal: drawn in the accent colour; can't be selected or deleted. */
  ghost?: boolean;
};
