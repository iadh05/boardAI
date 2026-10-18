import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GhostFlowNode } from '../../../lib/flowTypes.ts';

/** A node the AI proposes: dashed and faded until accepted. Finished in M1-23. */
export function GhostNode({ data }: NodeProps<GhostFlowNode>) {
  return (
    <div className="min-w-32 rounded-lg border-2 border-dashed border-accent bg-surface/70 px-3 py-2 text-sm text-ink opacity-80">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="font-medium">{data.label}</span>
      <span className="ml-2 text-xs text-accent">proposed</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
