import { useId } from 'react';
import { Input, type InputProps } from '../atoms/Input.tsx';

export type TextFieldProps = Omit<InputProps, 'id'> & {
  label: string;
  /** Helper text under the input. Stays visible when there is an error. */
  hint?: string;
  /** Error message; marks the input invalid. */
  error?: string;
};

/** Molecule: label + input + hint + error, wired together for screen readers. */
export function TextField({
  label,
  hint,
  error,
  className = '',
  'aria-describedby': callerDescribedBy,
  'aria-invalid': callerInvalid,
  ...inputProps
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // Keep the caller's description and add ours; error first, it matters most.
  const describedBy =
    [callerDescribedBy, error && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <Input
        {...inputProps}
        id={id}
        // An error always wins: the field must never look valid while showing one.
        aria-invalid={error ? true : callerInvalid}
        aria-describedby={describedBy}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
