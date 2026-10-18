import type { LucideIcon } from 'lucide-react';
import { Button, type ButtonProps } from '../atoms/Button.tsx';
import { Icon } from '../atoms/Icon.tsx';

export type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label'> & {
  icon: LucideIcon;
  /** Required: an icon alone gives the button no accessible name. */
  label: string;
};

/** Molecule: a square button showing only an icon, named by `label`. */
export function IconButton({
  icon,
  label,
  size = 'md',
  className = '',
  ...props
}: IconButtonProps) {
  const square = size === 'sm' ? 'w-8 px-0' : 'w-10 px-0';
  return (
    <Button
      aria-label={label}
      title={label}
      size={size}
      className={`${square} ${className}`}
      {...props}
    >
      <Icon icon={icon} size={size === 'sm' ? 'sm' : 'md'} />
    </Button>
  );
}
