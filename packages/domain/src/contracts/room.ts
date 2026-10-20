// A room's id (M2): the part of the link that names the board (`/room/k3x9a2b7q1zm`). Shared by
// the web app (makes and reads links) and the server (refuses anything else).

export const ROOM_ID_LENGTH = 12;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ROOM_ID = new RegExp(`^[a-z0-9]{${ROOM_ID_LENGTH}}$`);

/** Lowercase letters and digits only: nothing a path, a log line or a shell could misread. */
export const isRoomId = (id: string): boolean => ROOM_ID.test(id);

/**
 * A new id from random bytes (crypto.getRandomValues in the app). 12 characters from 36 is
 * ~62 bits: unguessable, since the link is the only access until auth (A5). Bytes ≥ 252 would
 * skew the letters (256 isn't a multiple of 36), so they're skipped and more are drawn.
 */
export const newRoomId = (randomBytes: (count: number) => Uint8Array): string => {
  let id = '';
  while (id.length < ROOM_ID_LENGTH) {
    for (const byte of randomBytes(ROOM_ID_LENGTH)) {
      if (byte >= 252 || id.length === ROOM_ID_LENGTH) continue;
      id += ALPHABET[byte % ALPHABET.length];
    }
  }
  return id;
};
