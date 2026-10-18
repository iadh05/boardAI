import { useId } from 'react';
import { Input, type InputProps } from '../atoms/Input.tsx';

export type TextFieldProps = Omit<InputProps, 'id'> & {
  label: string;
  /** Helper text under the input. */
  hint?: string;
  /** Error message; marks the input invalid. */
  error?: string;
};

/** Molecule: label + input (+ hint or error), wired together for screen readers. */
export function TextField({ label, hint, error, className = '', ...inputProps }: TextFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const description = error ?? hint;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={description ? descriptionId : undefined}
        {...inputProps}
      />
      {description && (
        <p id={descriptionId} className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {description}
        </p>
      )}
    </div>
  );
}
