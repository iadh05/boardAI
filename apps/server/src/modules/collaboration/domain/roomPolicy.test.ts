import { describe, expect, it } from 'vitest';
import { isRoomId, roomToDrop } from './roomPolicy.ts';

describe('room ids (M2-04)', () => {
  it.each(['k3x9a2b7q1zm', '000000000000'])('accepts %s', (id) => {
    expect(isRoomId(id)).toBe(true);
  });

  it.each(['', 'short', 'K3X9A2B7Q1ZM', 'k3x9a2b7q1zm0', '../etc/passwd', 'k3x9a2b7q1z-'])(
    'refuses %j',
    (id) => {
      expect(isRoomId(id)).toBe(false);
    },
  );
});

describe('which room to drop when the server is full (M2-04)', () => {
  it('the empty room left the longest ago', () => {
    expect(
      roomToDrop([
        { id: 'a', people: 0, emptySince: 300 },
        { id: 'b', people: 0, emptySince: 100 },
        { id: 'c', people: 2, emptySince: null },
      ]),
    ).toBe('b');
  });

  it('never a room with people in it', () => {
    expect(roomToDrop([{ id: 'c', people: 1, emptySince: null }])).toBeNull();
  });
});
