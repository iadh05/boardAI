import { useId, type ReactNode, type Ref } from 'react';

export type PanelProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** The scrolling body, for callers that manage its scroll (e.g. following a streaming chat). */
  bodyRef?: Ref<HTMLDivElement>;
};

/** Organism: a titled region with a scrolling body and an optional footer (e.g. the chat input). */
export function Panel({ title, children, footer, className = '', bodyRef }: PanelProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <h2 id={headingId} className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
        {title}
      </h2>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {children}
      </div>
      {footer && <footer className="border-t border-line p-3">{footer}</footer>}
    </section>
  );
}
