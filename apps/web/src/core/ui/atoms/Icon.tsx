import type { LucideIcon } from 'lucide-react';

export type IconSize = 'sm' | 'md' | 'lg';

export type IconProps = {
  icon: LucideIcon;
  size?: IconSize;
  /** Leave empty for decorative icons (hidden from screen readers); set it when the icon carries meaning on its own. */
  label?: string;
  className?: string;
};

const PIXELS: Record<IconSize, number> = { sm: 16, md: 20, lg: 24 };

/** Atom: the only place the app touches the icon library (lucide-react). */
export function Icon({ icon: Glyph, size = 'md', label, className }: IconProps) {
  return label ? (
    <Glyph size={PIXELS[size]} role="img" aria-label={label} className={className} />
  ) : (
    <Glyph size={PIXELS[size]} aria-hidden="true" className={className} />
  );
}
