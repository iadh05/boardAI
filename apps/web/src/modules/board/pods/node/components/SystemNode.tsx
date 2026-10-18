import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SystemFlowNode } from '../../canvas/index.ts';

/** A box on the board. M1-11 adds the kind icon and inline label editing. */
export function SystemNode({ data, selected }: NodeProps<SystemFlowNode>) {
  return (
    <div
      className={`min-w-32 rounded-lg border bg-surface px-3 py-2 text-sm text-ink shadow-sm ${
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-line'
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <span className="font-medium">{data.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
