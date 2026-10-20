import { describe, expect, it } from 'vitest';
import { createRoomRegistry, type Peer, type SyncRoom } from './rooms.ts';

/** A room that records who joined and what they sent: the Yjs protocol is tested in infra. */
const fakeRoom = () => {
  const received: Uint8Array[] = [];
  let destroyed = false;
  const room: SyncRoom = {
    join: () => ({ receive: (data) => received.push(data), leave: () => undefined }),
    destroy: () => {
      destroyed = true;
    },
  };
  return { room, received, isDestroyed: () => destroyed };
};

const peer: Peer = { send: () => undefined, close: () => undefined };
const ID = (n: number) => `room${String(n).padStart(8, '0')}`;

const setup = (limits = { maxRooms: 3, maxPeoplePerRoom: 2 }) => {
  let clock = 0;
  const rooms: ReturnType<typeof fakeRoom>[] = [];
  const registry = createRoomRegistry({
    newRoom: () => {
      const made = fakeRoom();
      rooms.push(made);
      return made.room;
    },
    now: () => clock,
    limits,
  });
  return { registry, rooms, tick: (ms: number) => (clock += ms) };
};

describe('room registry (M2-04)', () => {
  it('the same id is the same room; messages reach it', () => {
    const { registry, rooms } = setup();
    const a = registry.join(ID(1), peer);
    const b = registry.join(ID(1), peer);
    expect(a.ok && b.ok).toBe(true);
    expect(rooms).toHaveLength(1);

    if (a.ok) a.session.receive(new Uint8Array([1]));
    expect(rooms[0]?.received).toHaveLength(1);
    expect(registry.stats()).toEqual({ rooms: 1, people: 2 });
  });

  it('refuses a malformed room id', () => {
    const { registry } = setup();
    expect(registry.join('../../etc', peer)).toEqual({ ok: false, code: 'INVALID_ROOM' });
  });

  it('refuses one person too many in a room', () => {
    const { registry } = setup();
    registry.join(ID(1), peer);
    registry.join(ID(1), peer);
    expect(registry.join(ID(1), peer)).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('a room stays after everyone left (no saving until M3), and counts nobody', () => {
    const { registry, rooms } = setup();
    const a = registry.join(ID(1), peer);
    if (a.ok) a.session.leave();
    registry.join(ID(1), peer);
    expect(rooms).toHaveLength(1);
  });

  it('leaving twice counts once', () => {
    const { registry } = setup();
    const a = registry.join(ID(1), peer);
    if (a.ok) {
      a.session.leave();
      a.session.leave();
    }
    expect(registry.stats()).toEqual({ rooms: 1, people: 0 });
  });

  it('when full, drops the room empty the longest; never one with people', () => {
    const { registry, rooms, tick } = setup();
    for (const n of [1, 2, 3]) {
      const joined = registry.join(ID(n), peer);
      tick(10);
      if (joined.ok && n !== 3) joined.session.leave(); // room 3 keeps its person
      tick(10);
    }

    expect(registry.join(ID(4), peer).ok).toBe(true);
    expect(rooms[0]?.isDestroyed()).toBe(true); // room 1: empty the longest
    expect(rooms[1]?.isDestroyed()).toBe(false);
  });

  it('refuses a new room when every room has people', () => {
    const { registry } = setup({ maxRooms: 1, maxPeoplePerRoom: 2 });
    registry.join(ID(1), peer);
    expect(registry.join(ID(2), peer)).toEqual({ ok: false, code: 'SERVER_FULL' });
  });
});
