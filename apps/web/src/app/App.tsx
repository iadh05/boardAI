import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createQueryClient } from '../core/api/queryClient.ts';
import { ErrorBoundary } from '../core/observability/ErrorBoundary.tsx';
import { Button } from '../core/ui/index.ts';
import { AppShell } from '../layout/AppShell.tsx';
import { BoardCanvas } from '../modules/board/index.ts';
import { ChatPanel } from '../modules/chat/index.ts';
import { moveMyCursor, RemoteCursors, RoomStatus, useRoomLoaded } from '../modules/room/index.ts';

/** Shown if the page itself crashes: say so, and offer the way out. */
const pageCrashed = (
  <div
    role="alert"
    className="flex h-dvh flex-col items-center justify-center gap-3 p-8 text-center"
  >
    <p className="text-ink">
      Something went wrong and the page stopped. Reloading usually fixes it.
    </p>
    <Button variant="primary" onClick={() => window.location.reload()}>
      Reload the page
    </Button>
  </div>
);

/** Shown in the side panel if the chat crashes: the board keeps working. */
const chatCrashed = (
  <p role="alert" className="p-4 text-sm text-danger">
    The assistant crashed. Your board is safe; reload the page to start a new conversation.
  </p>
);

/**
 * Root component: providers + the page — the board's canvas and the assistant's chat. Two error
 * boundaries (frontend.md): one for the page, one for the chat, so a chat crash leaves the board.
 */
export function App() {
  // useState keeps one client for the app's lifetime, even if App re-renders.
  const [queryClient] = useState(createQueryClient);
  const roomLoaded = useRoomLoaded();

  return (
    <ErrorBoundary fallback={pageCrashed}>
      <QueryClientProvider client={queryClient}>
        <AppShell
          headerActions={<RoomStatus />}
          canvas={
            // The board knows nothing about rooms: the app hands it the room's cursors (M2-06).
            // fitKey: when a shared board arrives after the page opened, show all of it.
            <BoardCanvas onPointerMove={moveMyCursor} fitKey={roomLoaded}>
              <RemoteCursors />
            </BoardCanvas>
          }
          sidePanel={
            <ErrorBoundary fallback={chatCrashed}>
              <ChatPanel />
            </ErrorBoundary>
          }
        />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
