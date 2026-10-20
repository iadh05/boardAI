import { describe, expect, it } from 'vitest';
import { roomToDrop } from './roomPolicy.ts';

// Room ids are tested where they're defined: @designroom/domain (contracts/room.test.ts).

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
