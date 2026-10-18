import { PRODUCT_NAME } from '@designroom/domain';
import type { ReactNode } from 'react';

export type AppShellProps = {
  /** The diagram area (board module). */
  canvas: ReactNode;
  /** The right-hand panel (chat module). */
  sidePanel: ReactNode;
};

/** Page template: header on top, canvas on the left, assistant panel on the right. */
export function AppShell({ canvas, sidePanel }: AppShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex h-12 shrink-0 items-center border-b border-line bg-surface px-4">
        <h1 className="text-base font-semibold">{PRODUCT_NAME}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">{canvas}</main>
        <aside
          aria-label="Assistant"
          className="flex w-96 shrink-0 flex-col border-l border-line bg-surface"
        >
          {sidePanel}
        </aside>
      </div>
    </div>
  );
}
