import { PRODUCT_NAME } from '@designroom/domain';
import type { ReactNode } from 'react';

export type AppShellProps = {
  /** The diagram area (board module). */
  canvas: ReactNode;
  /** The right-hand panel (chat module). */
  sidePanel: ReactNode;
  /** Right side of the header (the room's connection and link, M2). */
  headerActions?: ReactNode;
};

/**
 * Page template: header on top, canvas, assistant panel. Wide screens: panel on the right.
 * Narrow screens (phones): stacked, canvas first, the chat below with 2/5 of the height —
 * enough for a few lines of conversation and the input.
 */
export function AppShell({ canvas, sidePanel, headerActions }: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4">
        <h1 className="text-base font-semibold">{PRODUCT_NAME}</h1>
        {headerActions}
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main className="min-h-0 min-w-0 flex-1">{canvas}</main>
        <aside
          aria-label="Assistant"
          className="flex h-2/5 shrink-0 flex-col border-t border-line bg-surface md:h-auto md:w-96 md:border-t-0 md:border-l"
        >
          {sidePanel}
        </aside>
      </div>
    </div>
  );
}
