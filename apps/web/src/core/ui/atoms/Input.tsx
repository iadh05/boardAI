import type { InputHTMLAttributes } from 'react';
import { FOCUS_RING } from './focusRing.ts';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Atom: a styled native <input>. Give it a label — through TextField, or `aria-label`. */
export function Input({ className = '', ...props }: InputProps) {
  return (
    <input
      className={`h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted aria-invalid:border-danger ${FOCUS_RING} ${className}`}
      {...props}
    />
  );
}
