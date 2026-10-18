import type { ButtonHTMLAttributes } from 'react';
import { FOCUS_RING } from './focusRing.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';
/** `square` = icon-only: width equals height, no side padding. */
export type ButtonShape = 'default' | 'square';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-hover',
  ghost: 'text-ink hover:bg-surface-hover',
};

// All sizing lives here, so callers never need padding/width overrides that would fight these
// classes (Tailwind resolves conflicting utilities by CSS order, not by class order).
const SIZE: Record<ButtonShape, Record<ButtonSize, string>> = {
  default: {
    sm: 'h-8 gap-1.5 px-2.5 text-sm',
    md: 'h-10 gap-2 px-4 text-sm',
  },
  square: {
    sm: 'size-8',
    md: 'size-10',
  },
};

/**
 * Atom: a native <button>. `type="button"` unless told otherwise, so it never submits a form by
 * accident. `className` is for layout around the button (margins, flex) — not for its own size.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  shape = 'default',
  type = 'button',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[shape][size]} ${FOCUS_RING} ${className}`}
      {...props}
    />
  );
}
