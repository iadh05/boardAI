import { describe, expect, it } from 'vitest';
import { isRoomId, newRoomId, ROOM_ID_LENGTH } from './room.ts';

describe('room ids (M2)', () => {
  it.each(['k3x9a2b7q1zm', '000000000000'])('accepts %s', (id) => {
    expect(isRoomId(id)).toBe(true);
  });

  it.each(['', 'short', 'K3X9A2B7Q1ZM', 'k3x9a2b7q1zm0', '../etc/passwd', 'k3x9a2b7q1z-'])(
    'refuses %j',
    (id) => {
      expect(isRoomId(id)).toBe(false);
    },
  );

  it('makes valid ids from random bytes', () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 37);
    const id = newRoomId(bytes);
    expect(id).toHaveLength(ROOM_ID_LENGTH);
    expect(isRoomId(id)).toBe(true);
  });

  it('uses every letter and digit (no bias toward a few)', () => {
    const all = Uint8Array.from({ length: 36 }, (_, i) => i);
    const seen = new Set<string>();
    for (let start = 0; start < 36; start += ROOM_ID_LENGTH) {
      for (const c of newRoomId(() => all.slice(start, start + ROOM_ID_LENGTH))) seen.add(c);
    }
    expect(seen.size).toBe(36);
  });
});
