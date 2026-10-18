import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { SIDES, type BoxNode, type Side } from '../flow/toReactFlow.ts';
import { Shape } from '../shapes/Shape.tsx';
import { useDiagramContext } from './DiagramContext.ts';
import { LabelEditor } from './LabelEditor.tsx';
import { NODE_SIZE } from './nodeSize.ts';

const POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/** A box: its shape outline, an optional icon, and the label (or the label editor). */
export function BoxNodeView({ id, data, selected }: NodeProps<BoxNode>) {
  const { editingNodeId, maxLabelLength, commitLabel, endEditing } = useDiagramContext();
  // React Flow shows a node (visibility) only once it has measured it, and a hidden input can't
  // take focus — so a brand-new node opens its editor after the first measure.
  const measured = useStore((s) => s.nodeLookup.get(id)?.measured.width !== undefined);
  const editing = editingNodeId === id && !data.ghost && measured;
  const color = data.ghost ? 'var(--dr-diagram-accent)' : (data.color ?? 'var(--dr-diagram-node)');

  return (
    <div
      className={`dr-node${selected ? 'is-selected' : ''}${data.ghost ? 'is-ghost' : ''}`}
      style={NODE_SIZE}
    >
      <Shape shape={data.ghost ? 'dashed' : data.shape} color={color} {...NODE_SIZE} />
      <div className="dr-node-content">
        {data.icon && (
          <span className="dr-node-icon" style={{ color }}>
            {data.icon}
          </span>
        )}
        {editing ? (
          <LabelEditor
            label={data.label}
            maxLength={maxLabelLength}
            onCommit={(label) => {
              commitLabel(id, label);
              endEditing();
            }}
            onCancel={endEditing}
          />
        ) : (
          <span className="dr-node-label">{data.label}</span>
        )}
        {data.ghost && <span className="dr-node-tag">proposed</span>}
      </div>
      {SIDES.map((side) => (
        // Test ids: handles have no accessible role — connecting is mouse-only in React Flow.
        <Handle
          key={side}
          id={side}
          type="source"
          position={POSITION[side]}
          isConnectable={!data.ghost}
          className="dr-handle"
          data-testid={`connect-${side}`}
        />
      ))}
    </div>
  );
}
