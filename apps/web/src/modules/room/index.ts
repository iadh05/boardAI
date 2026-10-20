// Public API of the room module (M2): which room this page is in, and the live connection to it.
// room → board: it connects the board's shared document; the board doesn't know rooms exist.
import { newRoomId } from '@designroom/domain';
import { WebsocketProvider } from 'y-websocket';
import { boardDocument } from '../board/index.ts';
import { connectRoom } from './api/connectRoom.ts';
import { roomFromPath, roomPath } from './lib/roomLink.ts';
import { useConnectionStore } from './store/connectionStore.ts';

/** The connection badge and the room link, for the page header. */
export { RoomStatus } from './pods/status/index.ts';

/**
 * Joins the room in the address bar, or opens a new one on `/` (and puts its link in the address
 * bar, so it can be shared or reloaded). Call once, before the first render.
 */
export const joinRoomFromUrl = (): (() => void) => {
  let roomId = roomFromPath(window.location.pathname);
  if (!roomId) {
    roomId = newRoomId((n) => crypto.getRandomValues(new Uint8Array(n)));
    window.history.replaceState(null, '', roomPath(roomId));
  }
  return connectRoom({
    doc: boardDocument,
    roomId,
    location: window.location,
    store: useConnectionStore,
    // disableBc: tabs of one browser would also sync directly (BroadcastChannel), so a tab could
    // show other tabs' edits while the server never got them. Every edit goes through the server.
    createProvider: (url, room, doc) => new WebsocketProvider(url, room, doc, { disableBc: true }),
  });
};
