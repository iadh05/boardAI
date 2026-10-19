import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createQueryClient } from '../core/api/queryClient.ts';
import { AppShell } from '../layout/AppShell.tsx';
import { BoardCanvas } from '../modules/board/index.ts';
import { ChatPanel } from '../modules/chat/index.ts';

/** Root component: providers + the page — the board's canvas and the assistant's chat. */
export function App() {
  // useState keeps one client for the app's lifetime, even if App re-renders.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell canvas={<BoardCanvas />} sidePanel={<ChatPanel />} />
    </QueryClientProvider>
  );
}
