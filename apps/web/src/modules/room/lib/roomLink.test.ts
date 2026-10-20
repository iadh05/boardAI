import { describe, expect, it } from 'vitest';
import { roomFromPath, roomPath } from './roomLink.ts';

describe('room links (M2-05)', () => {
  it('reads the room from /room/:id', () => {
    expect(roomFromPath('/room/k3x9a2b7q1zm')).toBe('k3x9a2b7q1zm');
    expect(roomFromPath('/room/k3x9a2b7q1zm/')).toBe('k3x9a2b7q1zm');
  });

  it.each(['/', '/room/', '/room/NOPE', '/room/k3x9a2b7q1zm/extra', '/other/k3x9a2b7q1zm'])(
    'no room in %j',
    (path) => {
      expect(roomFromPath(path)).toBeNull();
    },
  );

  it('builds the path of a room', () => {
    expect(roomPath('k3x9a2b7q1zm')).toBe('/room/k3x9a2b7q1zm');
  });
});
