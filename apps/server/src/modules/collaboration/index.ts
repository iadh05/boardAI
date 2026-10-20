import { metrics } from '@opentelemetry/api';
import type { Logger } from '../../core/logger.ts';
import { createCollabSocket } from './api/collabSocket.ts';
import { createRoomRegistry } from './application/rooms.ts';
import { ROOM_LIMITS } from './domain/roomPolicy.ts';
import { createYjsRoom } from './infra/yjsRoom.ts';

// The collaboration module (M2): rooms where several people edit one board live. Not an HTTP
// route: the WebSocket upgrade comes from the Node server (index.ts → handleUpgrade).

export type CollaborationModuleDeps = {
  logger: Logger;
  now?: () => number;
  limits?: { maxRooms: number; maxPeoplePerRoom: number; maxMessageBytes: number };
  heartbeatMs?: number;
  /** Per room; see createYjsRoom. Small in tests. */
  maxDocBytes?: number;
  measureEvery?: number;
};

export const createCollaborationModule = ({
  logger,
  now = Date.now,
  limits = ROOM_LIMITS,
  heartbeatMs,
  maxDocBytes,
  measureEvery,
}: CollaborationModuleDeps) => {
  // Instruments made here, not at import: the metrics API has no proxy (M1-26b).
  const meter = metrics.getMeter('@designroom/server');
  const messages = meter.createCounter('collab_messages_total', {
    description: 'Collaboration protocol messages received (sync and presence)',
  });
  const registry = createRoomRegistry({
    newRoom: () =>
      createYjsRoom({
        onMessage: () => messages.add(1),
        ...(maxDocBytes === undefined ? {} : { maxDocBytes }),
        ...(measureEvery === undefined ? {} : { measureEvery }),
      }),
    now,
    limits,
  });
  meter
    .createObservableGauge('collab_rooms', { description: 'Rooms held in memory' })
    .addCallback((result) => result.observe(registry.stats().rooms));
  meter
    .createObservableGauge('collab_connections', { description: 'People connected to a room' })
    .addCallback((result) => result.observe(registry.stats().people));

  return createCollabSocket({
    registry,
    logger,
    maxMessageBytes: limits.maxMessageBytes,
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
  });
};

export type CollaborationModule = ReturnType<typeof createCollaborationModule>;
