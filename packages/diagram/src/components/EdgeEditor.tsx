import { useRef, type FocusEvent, type KeyboardEvent } from 'react';

export type EdgeEditorProps = {
  label: string;
  dashed: boolean;
  /** Text of the dashed toggle ("Async" in DesignRoom). */
  dashedLabel: string;
  maxLength: number;
  onCommit: (label: string) => void;
  onCancel: () => void;
  onDashedChange: (dashed: boolean) => void;
};

/** Edits an arrow in place: its label, and a toggle for dashed (e.g. async). */
export function EdgeEditor({
  label,
  dashed,
  dashedLabel,
  maxLength,
  onCommit,
  onCancel,
  onDashedChange,
}: EdgeEditorProps) {
  // Enter/Escape close the editor, and closing can also fire blur: settle only once.
  const settled = useRef(false);
  const settle = (action: () => void) => {
    if (settled.current) return;
    settled.current = true;
    action();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keep keys for the text: React Flow must not act on them (Backspace would delete the arrow).
    event.stopPropagation();
    const input = event.currentTarget;
    if (event.key === 'Enter') settle(() => onCommit(input.value.replace(/\s+/g, ' ')));
    if (event.key === 'Escape') settle(onCancel);
  };

  // Leaving the editor saves — but moving between its input and its toggle does not.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    const input = event.currentTarget.querySelector('input');
    settle(() => onCommit((input?.value ?? label).replace(/\s+/g, ' ')));
  };

  return (
    <div className="dr-edge-editor nodrag nopan" onBlur={onBlur}>
      <input
        aria-label="Arrow label"
        defaultValue={label}
        maxLength={maxLength}
        placeholder="e.g. HTTPS"
        // Focus on open: the user just asked to edit this arrow.
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={onKeyDown}
        className="dr-label-input"
      />
      <button
        type="button"
        aria-pressed={dashed}
        onClick={() => onDashedChange(!dashed)}
        className="dr-edge-toggle"
      >
        {dashedLabel}
      </button>
    </div>
  );
}
