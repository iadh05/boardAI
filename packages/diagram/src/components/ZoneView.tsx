import { NodeResizeControl, useStore, type Node, type NodeProps } from '@xyflow/react';
import { LabelEditor } from './LabelEditor.tsx';
import { useZoneContext } from './ZoneContext.ts';

export type ZoneData = { label: string };
export type ZoneNode = Node<ZoneData, 'zone'>;

/** A zone: dashed rectangle with a title, behind the boxes. Resized from its bottom-right corner. */
export function ZoneView({ id, data, selected }: NodeProps<ZoneNode>) {
  const { editingZoneId, minSize, commitLabel, endEditing, resize } = useZoneContext();
  // Same rule as boxes: a hidden (unmeasured) input can't take focus.
  const measured = useStore((s) => s.nodeLookup.get(id)?.measured.width !== undefined);
  const editing = editingZoneId === id && measured;

  return (
    <div className={['dr-zone', selected && 'is-selected'].filter(Boolean).join(' ')}>
      <div className="dr-zone-title">
        {editing ? (
          <LabelEditor
            label={data.label}
            ariaLabel="Zone label"
            maxLength={100}
            onCommit={(label) => {
              commitLabel(id, label);
              endEditing();
            }}
            onCancel={endEditing}
          />
        ) : (
          data.label
        )}
      </div>
      <NodeResizeControl
        position="bottom-right"
        minWidth={minSize.width}
        minHeight={minSize.height}
        onResizeEnd={(_, { width, height }) => resize(id, { width, height })}
        className="dr-zone-resize"
      />
    </div>
  );
}
