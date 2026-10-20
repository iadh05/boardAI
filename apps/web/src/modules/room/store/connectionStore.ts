import { create } from 'zustand';

// The room connection as the user needs to see it (M2-05): are my edits reaching the others?

export type ConnectionStatus = 'connecting' | 'connected' | 'offline';

export type ConnectionState = {
  /** The room this page is in; null before joining. */
  roomId: string | null;
  status: ConnectionStatus;
  setRoom: (roomId: string) => void;
  setStatus: (status: ConnectionStatus) => void;
};

export const createConnectionStore = () =>
  create<ConnectionState>()((set) => ({
    roomId: null,
    status: 'connecting',
    setRoom: (roomId) => set({ roomId }),
    setStatus: (status) => set({ status }),
  }));

/** The app's connection store. */
export const useConnectionStore = createConnectionStore();
