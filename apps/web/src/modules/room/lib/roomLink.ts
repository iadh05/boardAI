import { isRoomId } from '@designroom/domain';

// Where a room lives in the address bar: /room/<id>. The link is how people join (M2-05).

const ROOM_PATH = /^\/room\/([^/]+)\/?$/;

/** The room named by a path, or null (the home page, a mistyped link). */
export const roomFromPath = (pathname: string): string | null => {
  const id = ROOM_PATH.exec(pathname)?.[1];
  return id !== undefined && isRoomId(id) ? id : null;
};

export const roomPath = (id: string): string => `/room/${id}`;
