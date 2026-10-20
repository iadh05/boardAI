import { isRoomId, ROOM_LIMITS, roomToDrop } from '../domain/roomPolicy.ts';

// The rooms of the server (M2-04): which exist, who is in them, which to drop when full. The
// shared document and its sync protocol are a port (`SyncRoom`), implemented with Yjs in infra.

/** One connected person, as the room sees them. */
export type Peer = {
  send: (data: Uint8Array) => void;
  close: (code: number, reason: string) => void;
};

/** What a person does once in a room: send it messages, then leave. */
export type PeerSession = {
  receive: (data: Uint8Array) => void;
  leave: () => void;
};

/** A shared document and the people editing it (port; infra/yjsRoom implements it). */
export type SyncRoom = {
  join: (peer: Peer) => PeerSession;
  destroy: () => void;
};

export type JoinRefusal = 'INVALID_ROOM' | 'ROOM_FULL' | 'SERVER_FULL';
export type JoinResult = { ok: true; session: PeerSession } | { ok: false; code: JoinRefusal };

export type RoomRegistryDeps = {
  newRoom: () => SyncRoom;
  now: () => number;
  limits?: { maxRooms: number; maxPeoplePerRoom: number };
};

type Entry = { room: SyncRoom; people: number; emptySince: number | null };

export const createRoomRegistry = ({ newRoom, now, limits = ROOM_LIMITS }: RoomRegistryDeps) => {
  const rooms = new Map<string, Entry>();

  /** An existing room, or a new one if there is space (dropping the room empty the longest). */
  const open = (id: string): Entry | null => {
    const existing = rooms.get(id);
    if (existing) return existing;
    if (rooms.size >= limits.maxRooms) {
      const drop = roomToDrop([...rooms].map(([roomId, e]) => ({ id: roomId, ...e })));
      if (drop === null) return null;
      rooms.get(drop)?.room.destroy();
      rooms.delete(drop);
    }
    const entry: Entry = { room: newRoom(), people: 0, emptySince: now() };
    rooms.set(id, entry);
    return entry;
  };

  return {
    join: (id: string, peer: Peer): JoinResult => {
      if (!isRoomId(id)) return { ok: false, code: 'INVALID_ROOM' };
      const entry = open(id);
      if (!entry) return { ok: false, code: 'SERVER_FULL' };
      if (entry.people >= limits.maxPeoplePerRoom) return { ok: false, code: 'ROOM_FULL' };

      entry.people++;
      entry.emptySince = null;
      const session = entry.room.join(peer);
      let left = false;
      return {
        ok: true,
        session: {
          receive: session.receive,
          leave: () => {
            if (left) return; // close and error can both fire for one socket
            left = true;
            session.leave();
            entry.people--;
            if (entry.people === 0) entry.emptySince = now();
          },
        },
      };
    },
    stats: () => ({
      rooms: rooms.size,
      people: [...rooms.values()].reduce((sum, e) => sum + e.people, 0),
    }),
  };
};

export type RoomRegistry = ReturnType<typeof createRoomRegistry>;
