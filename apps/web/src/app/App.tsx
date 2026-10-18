import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createQueryClient } from '../core/api/queryClient.ts';
import { AppShell } from '../layout/AppShell.tsx';
import { BoardCanvas } from '../modules/board/index.ts';

/** Root component: providers + the page. Canvas and chat arrive with the board and chat modules. */
export function App() {
  // useState keeps one client for the app's lifetime, even if App re-renders.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell
        canvas={<BoardCanvas />}
        sidePanel={<p className="p-4 text-sm text-muted">Assistant — coming in M1-22.</p>}
      />
    </QueryClientProvider>
  );
}
