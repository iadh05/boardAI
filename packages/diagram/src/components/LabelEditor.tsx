import { useRef, type KeyboardEvent } from 'react';

export type LabelEditorProps = {
  label: string;
  maxLength: number;
  /** Called once, with the typed text on one line. */
  onCommit: (label: string) => void;
  onCancel: () => void;
};

/** Labels are one line: pasted tabs and line breaks become spaces. */
const singleLine = (text: string) => text.replace(/\s+/g, ' ');

/** In-place label input: Enter or leaving it saves, Escape cancels. */
export function LabelEditor({ label, maxLength, onCommit, onCancel }: LabelEditorProps) {
  // Enter/Escape close the editor, and closing can also fire blur: settle only once.
  const settled = useRef(false);
  const settle = (action: () => void) => {
    if (settled.current) return;
    settled.current = true;
    action();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keep keys for the text: React Flow must not act on them (Backspace would delete the node).
    event.stopPropagation();
    if (event.key !== 'Enter' && event.key !== 'Escape') return;

    const input = event.currentTarget;
    // The input disappears on close; hand focus back to the node so keyboard users keep their place.
    const node = input.closest<HTMLElement>('.react-flow__node');
    settle(() => (event.key === 'Enter' ? onCommit(singleLine(input.value)) : onCancel()));
    node?.focus();
  };

  return (
    <input
      aria-label="Node label"
      defaultValue={label}
      maxLength={maxLength}
      // Focus on open: the user just asked to edit this label.
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={onKeyDown}
      onBlur={(event) => settle(() => onCommit(singleLine(event.currentTarget.value)))}
      // nodrag/nopan: dragging inside the input selects text instead of moving the node or the view.
      className="dr-label-input nodrag nopan"
    />
  );
}
