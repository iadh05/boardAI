import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { FOCUS_RING } from '../atoms/focusRing.ts';
import { Icon } from '../atoms/Icon.tsx';

export type ToolButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> & {
  icon: LucideIcon;
  /** Visible name under the icon ("Database"). */
  caption: string;
  /** Accessible name, when it says more than the caption ("Add Database"). */
  label?: string;
};

/** Molecule: a palette button — icon with its name underneath, found without hovering. */
export function ToolButton({ icon, caption, label, className = '', ...props }: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label ?? caption}
      className={`flex w-16 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-ink transition-colors hover:bg-surface-hover ${FOCUS_RING} ${className}`}
      {...props}
    >
      <Icon icon={icon} />
      <span className="text-center text-xs leading-tight">{caption}</span>
    </button>
  );
}
