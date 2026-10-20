import { create } from 'zustand';

// Who else is in the room, and where their pointer is (M2-06). Presence only: nothing here is
// saved, and it's gone when they leave.

export type Position = { x: number; y: number };

/** How a person shows on screen: a name and one of the palette's colours (0–7). */
export type Identity = { name: string; color: number };

export type Person = Identity & {
  /** Presence id (Yjs awareness client id): one per open tab. */
  id: number;
  /** On the board, in diagram coordinates; null when their pointer is elsewhere. */
  cursor: Position | null;
};

export type PresenceState = {
  me: Identity | null;
  others: Person[];
  setMe: (me: Identity) => void;
  setOthers: (others: Person[]) => void;
};

export const createPresenceStore = () =>
  create<PresenceState>()((set) => ({
    me: null,
    others: [],
    setMe: (me) => set({ me }),
    setOthers: (others) => set({ others }),
  }));

/** The app's presence store. */
export const usePresenceStore = createPresenceStore();
