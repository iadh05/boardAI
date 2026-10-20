// Rules for rooms (M2 spec §3). Pure: no sockets, no clock. What a room id looks like is shared
// with the web app: `isRoomId` in @designroom/domain.

export { isRoomId } from '@designroom/domain';

/** The server keeps rooms in memory (M3 saves them): limits keep it from being filled up. */
export const ROOM_LIMITS = {
  maxRooms: 100,
  maxPeoplePerRoom: 20,
  /** One WebSocket message; a whole board update is far smaller. */
  maxMessageBytes: 1024 * 1024,
} as const;

export type RoomUsage = {
  id: string;
  people: number;
  /** When the last person left (ms); null while someone is in it. */
  emptySince: number | null;
};

/** To make space: the room that has been empty the longest. A room with people never goes. */
export const roomToDrop = (rooms: readonly RoomUsage[]): string | null => {
  let oldest: RoomUsage | null = null;
  for (const room of rooms) {
    if (room.people > 0 || room.emptySince === null) continue;
    if (!oldest || room.emptySince < (oldest.emptySince ?? Infinity)) oldest = room;
  }
  return oldest?.id ?? null;
};
