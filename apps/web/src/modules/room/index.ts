// Public API of the room module (M2): which room this page is in, the live connection to it, and
// who else is here. room → board: it connects the board's shared document; the board doesn't
// know rooms exist.
import { WebsocketProvider } from 'y-websocket';
import { boardDocument } from '../board/index.ts';
import { joinRoomFromUrl as join } from './api/joinRoomFromUrl.ts';
import { startPresence, type Presence } from './api/presence.ts';
import { useConnectionStore } from './store/connectionStore.ts';
import { usePresenceStore, type Position } from './store/presenceStore.ts';

/** The connection badge, people count and room link, for the page header. */
export { RoomStatus } from './pods/status/index.ts';
/** Other people's pointers: render as a child of the board canvas. */
export { RemoteCursors } from './pods/cursors/index.ts';

let presence: Presence | null = null;

/** Joins the room in the address bar (or opens a new one). Call once, before the first render. */
export const joinRoomFromUrl = () => {
  const room = join({
    doc: boardDocument,
    store: useConnectionStore,
    location: window.location,
    replacePath: (path) => window.history.replaceState(null, '', path),
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    // disableBc: tabs of one browser would also sync directly (BroadcastChannel), so a tab could
    // show other tabs' edits while the server never got them. Every edit goes through the server.
    createProvider: (url, roomId, doc) =>
      new WebsocketProvider(url, roomId, doc, { disableBc: true }),
    network: {
      onChange: (handler) => {
        const online = () => handler(true);
        const offline = () => handler(false);
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);
        return () => {
          window.removeEventListener('online', online);
          window.removeEventListener('offline', offline);
        };
      },
    },
  });
  presence = startPresence({ awareness: room.awareness, store: usePresenceStore });
  return room;
};

/** Whether the room's board has arrived (true after the first sync). */
export const useRoomLoaded = () => useConnectionStore((s) => s.loaded);

/** Shares where this person's pointer is on the board (null: off the board). */
export const moveMyCursor = (position: Position | null) => presence?.setCursor(position);
