import type * as Y from 'yjs';
import type { ConnectionStatus, useConnectionStore } from '../store/connectionStore.ts';

// Joins a room: connects the board's shared document to the server (M2-05), and keeps the
// connection store in step. The provider (y-websocket) does the protocol: it syncs on connect,
// sends every local change, and reconnects with backoff after a drop — edits made offline are
// sent then.

/** What we use of the y-websocket provider (injected, so tests need no server). */
export type RoomProvider = {
  on: (event: 'status', handler: (event: { status: string }) => void) => void;
  destroy: () => void;
};

export type ConnectRoomDeps = {
  doc: Y.Doc;
  roomId: string;
  location: Pick<Location, 'protocol' | 'host'>;
  store: typeof useConnectionStore;
  createProvider: (serverUrl: string, roomId: string, doc: Y.Doc) => RoomProvider;
};

const STATUS: Record<string, ConnectionStatus> = {
  connected: 'connected',
  connecting: 'connecting',
  disconnected: 'offline',
};

/** Connects; returns how to leave. Same origin as the page: Nginx forwards /ws/ (M2-05). */
export const connectRoom = ({ doc, roomId, location, store, createProvider }: ConnectRoomDeps) => {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  store.getState().setRoom(roomId);
  store.getState().setStatus('connecting');
  const provider = createProvider(`${scheme}://${location.host}/ws/rooms`, roomId, doc);
  provider.on('status', ({ status }) => {
    const mapped = STATUS[status];
    if (mapped) store.getState().setStatus(mapped);
  });
  return () => provider.destroy();
};
