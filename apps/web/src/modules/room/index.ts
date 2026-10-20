// Public API of the room module (M2): which room this page is in, and the live connection to it.
// room → board: it connects the board's shared document; the board doesn't know rooms exist.
import { WebsocketProvider } from 'y-websocket';
import { boardDocument } from '../board/index.ts';
import { joinRoomFromUrl as join } from './api/joinRoomFromUrl.ts';
import { useConnectionStore } from './store/connectionStore.ts';

/** The connection badge and the room link, for the page header. */
export { RoomStatus } from './pods/status/index.ts';

/** Joins the room in the address bar (or opens a new one). Call once, before the first render. */
export const joinRoomFromUrl = () =>
  join({
    doc: boardDocument,
    store: useConnectionStore,
    location: window.location,
    replacePath: (path) => window.history.replaceState(null, '', path),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    // disableBc: tabs of one browser would also sync directly (BroadcastChannel), so a tab could
    // show other tabs' edits while the server never got them. Every edit goes through the server.
    createProvider: (url, room, doc) => new WebsocketProvider(url, room, doc, { disableBc: true }),
  });
