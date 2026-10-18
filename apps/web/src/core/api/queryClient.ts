import { QueryClient } from '@tanstack/react-query';

/** One QueryClient per app. Server state only — client state lives in Zustand stores. */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
