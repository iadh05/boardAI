import { KIND_DEFAULT_LABEL } from '@designroom/domain';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Icon } from '../../../../../core/ui/index.ts';
import { KIND_ICON, KIND_TONE } from '../../../lib/kindAppearance.ts';
import type { SystemFlowNode } from '../../../lib/flowTypes.ts';
import { useBoardStoreFromContext } from '../../../store/boardStoreContext.ts';
import { LabelEditor } from './LabelEditor.tsx';

/**
 * A box on the board: kind icon + label, or the label editor while it's being renamed.
 * What opens the editor (double-click, Enter) is wired in the canvas pod.
 */
export function SystemNode({ id, data, selected }: NodeProps<SystemFlowNode>) {
  const store = useBoardStoreFromContext();
  const editing = store((s) => s.editingNodeId === id);
  const stopEditing = store((s) => s.stopEditing);
  const renameNode = store((s) => s.renameNode);

  return (
    <div
      className={`flex min-w-40 items-center gap-2 rounded-lg border bg-surface p-2 text-sm text-ink shadow-sm ${
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-line'
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-md ${KIND_TONE[data.kind]}`}
      >
        {/* Named, so screen readers hear the kind even when the label says something else. */}
        <Icon icon={KIND_ICON[data.kind]} label={KIND_DEFAULT_LABEL[data.kind]} />
      </span>
      {editing ? (
        <LabelEditor
          label={data.label}
          onCommit={(label) => {
            renameNode(id, label);
            stopEditing();
          }}
          onCancel={stopEditing}
        />
      ) : (
        <span className="truncate font-medium">{data.label}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
