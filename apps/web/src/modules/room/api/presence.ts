import type { Awareness } from 'y-protocols/awareness';
import type { Identity, Person, Position, usePresenceStore } from '../store/presenceStore.ts';

// Presence (M2-06) over Yjs awareness: each tab shares a name, a colour and its cursor; the
// server relays it and drops it when the tab leaves. What other tabs share is data from other
// people's browsers, so it's checked before it reaches the screen.

/** Pointer moves shared at most this often: smooth enough to follow, not a message per pixel. */
const CURSOR_EVERY_MS = 50;
const PALETTE_SIZE = 8;
const MAX_NAME = 40;

/** The same on every screen, from the presence id: no sign-in until A5. */
export const identityFor = (clientId: number): Identity => ({
  name: `Guest ${String(clientId % 100).padStart(2, '0')}`,
  color: clientId % PALETTE_SIZE,
});

const isPosition = (value: unknown): value is Position =>
  typeof value === 'object' &&
  value !== null &&
  Number.isFinite((value as Position).x) &&
  Number.isFinite((value as Position).y);

/** Someone's shared state, made safe to show; null if it isn't a person at all. */
const toPerson = (id: number, state: unknown): Person | null => {
  if (typeof state !== 'object' || state === null) return null;
  const { user, cursor } = state as { user?: unknown; cursor?: unknown };
  if (typeof user !== 'object' || user === null) return null;
  const { name, color } = user as { name?: unknown; color?: unknown };
  const fallback = identityFor(id);
  return {
    id,
    name: typeof name === 'string' && name.trim() ? name.slice(0, MAX_NAME) : fallback.name,
    color:
      Number.isInteger(color) && (color as number) >= 0 && (color as number) < PALETTE_SIZE
        ? (color as number)
        : fallback.color,
    cursor: isPosition(cursor) ? { x: cursor.x, y: cursor.y } : null,
  };
};

export type PresenceDeps = {
  awareness: Awareness;
  store: typeof usePresenceStore;
};

/** Shares this tab's presence and follows the others'. */
export const startPresence = ({ awareness, store }: PresenceDeps) => {
  const me = identityFor(awareness.clientID);
  store.getState().setMe(me);
  awareness.setLocalStateField('user', me);

  const read = () => {
    const others: Person[] = [];
    awareness.getStates().forEach((state, id) => {
      if (id === awareness.clientID) return;
      const person = toPerson(id, state);
      if (person) others.push(person);
    });
    store.getState().setOthers(others);
  };
  awareness.on('change', read);
  read();

  // Throttled: the first move goes at once, later ones at most every 50 ms, and the last
  // position always goes (so the cursor never stops short of where the pointer stopped).
  let pending: Position | null | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (pending === undefined) return;
    awareness.setLocalStateField('cursor', pending);
    pending = undefined;
    timer = setTimeout(flush, CURSOR_EVERY_MS);
  };

  return {
    setCursor: (position: Position | null) => {
      pending = position;
      if (!timer) flush();
    },
    stop: () => {
      if (timer) clearTimeout(timer);
      awareness.off('change', read);
    },
  };
};

export type Presence = ReturnType<typeof startPresence>;
