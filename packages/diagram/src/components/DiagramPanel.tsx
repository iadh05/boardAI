import { Panel, type PanelPosition } from '@xyflow/react';
import type { ReactNode } from 'react';

export type DiagramPanelPosition = PanelPosition;

export type DiagramPanelProps = { position: DiagramPanelPosition; children: ReactNode };

/** Content floating over the diagram (a toolbar, a legend). Render it as a child of <Diagram>. */
export function DiagramPanel({ position, children }: DiagramPanelProps) {
  return <Panel position={position}>{children}</Panel>;
}
