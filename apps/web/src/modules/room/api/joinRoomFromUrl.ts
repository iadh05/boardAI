import { newRoomId } from '@designroom/domain';
import type * as Y from 'yjs';
import { roomFromPath, roomPath } from '../lib/roomLink.ts';
import type { useConnectionStore } from '../store/connectionStore.ts';
import { connectRoom, type RoomProvider } from './connectRoom.ts';

export type JoinRoomDeps = {
  doc: Y.Doc;
  store: typeof useConnectionStore;
  location: Pick<Location, 'pathname' | 'protocol' | 'host'>;
  /** Puts the new room's link in the address bar (history.replaceState in the app). */
  replacePath: (path: string) => void;
  randomBytes: (count: number) => Uint8Array;
  createProvider: (serverUrl: string, roomId: string, doc: Y.Doc) => RoomProvider;
};

/**
 * Joins the room in the address bar, or opens a new one on `/` and puts its link in the address
 * bar, so it can be shared or reloaded (M2-05). Returns how to leave.
 */
export const joinRoomFromUrl = ({
  doc,
  store,
  location,
  replacePath,
  randomBytes,
  createProvider,
}: JoinRoomDeps) => {
  let roomId = roomFromPath(location.pathname);
  if (!roomId) {
    roomId = newRoomId(randomBytes);
    replacePath(roomPath(roomId));
  }
  return connectRoom({ doc, roomId, location, store, createProvider });
};
