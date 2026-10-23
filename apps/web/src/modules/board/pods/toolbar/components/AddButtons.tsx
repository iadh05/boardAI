import { KIND_DEFAULT_LABEL, type NodeKind } from '@designroom/domain';
import { SquareDashed } from 'lucide-react';
import { ToolButton } from '../../../../../core/ui/index.ts';
import { KIND_ICON, TOOLBAR_KINDS } from '../../../lib/kindAppearance.ts';

export type AddButtonsProps = {
  onAddNode: (kind: NodeKind) => void;
  onAddZone: () => void;
};

/** One button per kind, then Zone: the "Add a node" toolbar (inside the toolbar's shared box). */
export function AddButtons({ onAddNode, onAddZone }: AddButtonsProps) {
  return (
    <div role="toolbar" aria-label="Add a node" className="contents">
      {TOOLBAR_KINDS.map((kind) => (
        <ToolButton
          key={kind}
          icon={KIND_ICON[kind]}
          caption={KIND_DEFAULT_LABEL[kind]}
          label={`Add ${KIND_DEFAULT_LABEL[kind]}`}
          onClick={() => onAddNode(kind)}
        />
      ))}
      <span
        role="separator"
        aria-orientation="vertical"
        className="mx-1 w-px self-stretch bg-line"
      />
      <ToolButton icon={SquareDashed} caption="Zone" label="Add Zone" onClick={onAddZone} />
    </div>
  );
}
