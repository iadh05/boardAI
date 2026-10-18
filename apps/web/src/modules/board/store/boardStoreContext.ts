import { createContext, useContext } from 'react';
import { useBoardStore } from './boardStore.ts';

/**
 * Which board store the components under a Canvas use. React Flow renders node components
 * itself (props: the node only), so they find the store here — dependency injection, not app
 * state. Defaults to the app's store; the Canvas provides its own (a test store in tests).
 */
export const BoardStoreContext = createContext<typeof useBoardStore>(useBoardStore);

export const useBoardStoreFromContext = () => useContext(BoardStoreContext);
