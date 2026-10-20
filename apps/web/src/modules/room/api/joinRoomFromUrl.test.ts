import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createConnectionStore } from '../store/connectionStore.ts';
import type { RoomProvider } from './connectRoom.ts';
import { joinRoomFromUrl } from './joinRoomFromUrl.ts';

const provider: RoomProvider = {
  on: () => undefined,
  awareness: new Awareness(new Y.Doc()),
  destroy: () => undefined,
};

const join = (pathname: string) => {
  const replaced: string[] = [];
  const rooms: string[] = [];
  const store = createConnectionStore();
  joinRoomFromUrl({
    doc: new Y.Doc(),
    store,
    location: { pathname, protocol: 'http:', host: 'localhost:8080' },
    replacePath: (path) => replaced.push(path),
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i),
    createProvider: (_url, room) => {
      rooms.push(room);
      return provider;
    },
  });
  return { replaced, rooms, store };
};

describe('joining the room in the link (M2-05)', () => {
  it('joins the room the link names, and leaves the address bar alone', () => {
    const { replaced, rooms } = join('/room/k3x9a2b7q1zm');
    expect(rooms).toEqual(['k3x9a2b7q1zm']);
    expect(replaced).toEqual([]);
  });

  it('on the home page, opens a new room and puts its link in the address bar', () => {
    const { replaced, rooms } = join('/');
    expect(rooms).toEqual(['abcdefghijkl']);
    expect(replaced).toEqual(['/room/abcdefghijkl']);
  });

  it('a mistyped link opens a new room instead of a broken one', () => {
    const { rooms } = join('/room/NOT-A-ROOM');
    expect(rooms).toEqual(['abcdefghijkl']);
  });
});
