import { create } from 'zustand';

// The room connection as the user needs to see it (M2-05): are my edits reaching the others?

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

export type ConnectionState = {
  /** The room this page is in; null before joining. */
  roomId: string | null;
  status: ConnectionStatus;
  /** The room's board has arrived at least once (before that, an empty canvas means "loading"). */
  loaded: boolean;
  setRoom: (roomId: string) => void;
  setStatus: (status: ConnectionStatus) => void;
  setLoaded: () => void;
};

export const createConnectionStore = () =>
  create<ConnectionState>()((set) => ({
    roomId: null,
    status: 'connecting',
    loaded: false,
    setRoom: (roomId) => set({ roomId }),
    setStatus: (status) => set({ status }),
    setLoaded: () => set({ loaded: true }),
  }));

/** The app's connection store. */
export const useConnectionStore = createConnectionStore();
