import { MAX_LABEL_LENGTH } from '@designroom/domain';
import { useRef, type KeyboardEvent } from 'react';
import { Input } from '../../../../../core/ui/index.ts';

export type LabelEditorProps = {
  label: string;
  /** Called once, with the typed text (the store trims it and turns empty into the kind name). */
  onCommit: (label: string) => void;
  onCancel: () => void;
};

/**
 * One line of text: pasted tabs and line breaks become spaces (the domain refuses control
 * characters, and a refused rename would just leave the old label).
 */
const singleLine = (text: string) => text.replace(/\s+/g, ' ');

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
    if (event.key !== 'Enter' && event.key !== 'Escape') return;

    const input = event.currentTarget;
    // The input disappears on close; hand focus back to the node so keyboard users keep their place.
    const node = input.closest<HTMLElement>('.react-flow__node');
    settle(() => (event.key === 'Enter' ? onCommit(singleLine(input.value)) : onCancel()));
    node?.focus();
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
      onBlur={(event) => settle(() => onCommit(singleLine(event.currentTarget.value)))}
      // nodrag/nopan: dragging inside the input selects text instead of moving the node or the view.
      className="nodrag nopan h-8 px-2"
    />
  );
}
