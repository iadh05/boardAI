import { PRODUCT_NAME } from '@designroom/domain';
import type { ReactNode } from 'react';

export type AppShellProps = {
  /** The diagram area (board module). */
  canvas: ReactNode;
  /** The right-hand panel (chat module). */
  sidePanel: ReactNode;
};

/**
 * Page template: header on top, canvas, assistant panel. Wide screens: panel on the right.
 * Narrow screens (phones): stacked, canvas first, a short panel below.
 */
export function AppShell({ canvas, sidePanel }: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
        <h1 className="text-base font-semibold">{PRODUCT_NAME}</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main className="min-h-0 min-w-0 flex-1">{canvas}</main>
        <aside
          aria-label="Assistant"
          className="flex h-40 shrink-0 flex-col border-t border-line bg-surface md:h-auto md:w-96 md:border-t-0 md:border-l"
        >
          {sidePanel}
        </aside>
      </div>
    </div>
  );
}
