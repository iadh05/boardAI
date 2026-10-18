import { MAX_LABEL_LENGTH } from '@designroom/domain';
import { useRef, type KeyboardEvent } from 'react';
import { Input } from '../../../../../core/ui/index.ts';

export type LabelEditorProps = {
  label: string;
  /** Called once, with the typed text (the store trims it and turns empty into the kind name). */
  onCommit: (label: string) => void;
  onCancel: () => void;
};

/** In-place label input: Enter or leaving it saves, Escape cancels. */
export function LabelEditor({ label, onCommit, onCancel }: LabelEditorProps) {
  // Enter/Escape close the editor, and closing can also fire blur: settle only once.
  const settled = useRef(false);
  const settle = (action: () => void) => {
    if (settled.current) return;
    settled.current = true;
    action();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keep keys for the text: React Flow must not act on them (e.g. Backspace = delete, M1-12).
    event.stopPropagation();
    if (event.key === 'Enter') settle(() => onCommit(event.currentTarget.value));
    if (event.key === 'Escape') settle(onCancel);
  };

  return (
    <Input
      aria-label="Node label"
      defaultValue={label}
      maxLength={MAX_LABEL_LENGTH}
      // Focus on open: the user just asked to edit this label.
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(event) => settle(() => onCommit(event.currentTarget.value))}
      // nodrag/nopan: dragging inside the input selects text instead of moving the node or the view.
      className="nodrag nopan h-8 px-2"
    />
  );
}
