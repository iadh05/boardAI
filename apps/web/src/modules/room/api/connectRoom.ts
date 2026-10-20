import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { ConnectionStatus, useConnectionStore } from '../store/connectionStore.ts';

// Joins a room: connects the board's shared document to the server (M2-05), and keeps the
// connection store in step. The provider (y-websocket) does the protocol: it syncs on connect,
// sends every local change, and reconnects with backoff after a drop — edits made offline are
// sent then.

/** What we use of the y-websocket provider (injected, so tests need no server). */
export type RoomProvider = {
  on: {
    (event: 'status', handler: (event: { status: string }) => void): void;
    /** true once the room's board has been received (and after each reconnect). */
    (event: 'sync', handler: (synced: boolean) => void): void;
  };
  /** Presence (who's here, their cursor): relayed by the server, never saved (M2-06). */
  awareness: Awareness;
  connect: () => void;
  disconnect: () => void;
  destroy: () => void;
};

/** The browser's own idea of the network (window 'online' / 'offline' in the app). */
export type NetworkEvents = {
  onChange: (handler: (online: boolean) => void) => () => void;
};

export type ConnectRoomDeps = {
  doc: Y.Doc;
  roomId: string;
  location: Pick<Location, 'protocol' | 'host'>;
  store: typeof useConnectionStore;
  createProvider: (serverUrl: string, roomId: string, doc: Y.Doc) => RoomProvider;
  network?: NetworkEvents;
};

const STATUS: Record<string, ConnectionStatus> = {
  connected: 'connected',
  connecting: 'connecting',
  disconnected: 'offline',
};

/**
 * Connects; returns the room's presence and how to leave. Same origin as the page: Nginx
 * forwards /ws/ (M2-05).
 */
export const connectRoom = ({
  doc,
  roomId,
  location,
  store,
  createProvider,
  network,
}: ConnectRoomDeps) => {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  store.getState().setRoom(roomId);
  store.getState().setStatus('connecting');
  const provider = createProvider(`${scheme}://${location.host}/ws/rooms`, roomId, doc);
  provider.on('status', ({ status }) => {
    const mapped = STATUS[status];
    if (mapped) store.getState().setStatus(mapped);
  });
  provider.on('sync', (synced) => {
    if (synced) store.getState().setLoaded();
  });
  // When the network goes, an open WebSocket isn't told: the provider would notice only after
  // its own timeout (up to 30 s), saying "Connected" all along. The browser knows at once — say
  // "Offline" and stop trying; reconnect when it's back (edits made meanwhile are sent then).
  const stopWatching = network?.onChange((online) => {
    if (online) {
      provider.connect();
    } else {
      provider.disconnect();
      store.getState().setStatus('offline');
    }
  });
  return {
    awareness: provider.awareness,
    leave: () => {
      stopWatching?.();
      provider.destroy();
    },
  };
};

export type RoomConnection = ReturnType<typeof connectRoom>;
