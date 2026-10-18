import type { ReactNode } from 'react';

export type CardProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

/** Molecule: a bordered surface with an optional title. */
export function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-3 ${className}`}>
      {title && <p className="mb-1 text-sm font-semibold text-ink">{title}</p>}
      <div className="text-sm text-ink">{children}</div>
    </div>
  );
}
