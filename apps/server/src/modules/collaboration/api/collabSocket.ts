import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { Logger } from '../../../core/logger.ts';
import type { JoinRefusal, RoomRegistry } from '../application/rooms.ts';

// The collaboration WebSocket (M2-04): GET /ws/rooms/:id upgraded to a WebSocket, one per person.
// Hono doesn't do upgrades on Node, so the HTTP server hands them here (index.ts).

const ROOM_PATH = /^\/ws\/rooms\/([^/]+)$/;

/** Close codes a browser can act on: 1008 = not allowed, 1013 = try again later. */
const REFUSAL_CLOSE: Record<JoinRefusal, number> = {
  INVALID_ROOM: 1008,
  ROOM_FULL: 1013,
  SERVER_FULL: 1013,
};

const toBytes = (data: RawData): Uint8Array =>
  Array.isArray(data)
    ? new Uint8Array(Buffer.concat(data))
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data);

export type CollabSocketDeps = {
  registry: RoomRegistry;
  logger: Logger;
  maxMessageBytes: number;
  /** A connection that misses a ping for this long is dropped (a laptop closed mid-session). */
  heartbeatMs?: number;
};

export const createCollabSocket = ({
  registry,
  logger,
  maxMessageBytes,
  heartbeatMs = 30_000,
}: CollabSocketDeps) => {
  // Over the limit, `ws` closes the connection itself (1009, message too big).
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxMessageBytes });
  const alive = new WeakMap<WebSocket, boolean>();

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref(); // never keeps the process alive on its own

  const connect = (ws: WebSocket, roomId: string) => {
    // The id is the room's only key: logs get a prefix, enough to follow one room, not to join it.
    const room = `${roomId.slice(0, 4)}…`;
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    const joined = registry.join(roomId, {
      send: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    });
    if (!joined.ok) {
      logger.info('collab refused', { room, reason: joined.code });
      ws.close(REFUSAL_CLOSE[joined.code], joined.code);
      return;
    }
    logger.info('collab joined', { room, ...registry.stats() });
    ws.on('message', (data) => joined.session.receive(toBytes(data)));
    const leave = () => joined.session.leave();
    ws.on('close', leave);
    ws.on('error', leave);
  };

  return {
    /** For the HTTP server's 'upgrade' event. Anything but /ws/rooms/:id gets a 404. */
    handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const match = ROOM_PATH.exec(path);
      if (!match?.[1]) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
      }
      const roomId = match[1];
      wss.handleUpgrade(req, socket, head, (ws) => connect(ws, roomId));
    },
    /** Closes every connection (shutdown, tests). */
    close: () => {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
};

export type CollabSocket = ReturnType<typeof createCollabSocket>;
