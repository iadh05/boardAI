import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { createLogger } from '../../core/logger.ts';
import { createCollaborationModule } from './index.ts';

// M2-04 end to end on localhost: a real HTTP server, the module on its upgrade event, and the same
// `y-websocket` provider the browser uses (with Node's `ws` as its WebSocket).

const ROOM = 'k3x9a2b7q1zm';
const OTHER_ROOM = 'zz0000000000';

let server: Server;
let close: () => void = () => undefined;
const providers: WebsocketProvider[] = [];

/** Reads metrics on demand (the SDK's MetricReader is abstract). */
class TestReader extends MetricReader {
  protected onShutdown = () => Promise.resolve();
  protected onForceFlush = () => Promise.resolve();
}

const start = async (
  limits?: Parameters<typeof createCollaborationModule>[0]['limits'],
  heartbeatMs?: number,
) => {
  const collab = createCollaborationModule({
    logger: createLogger({ level: 'error', write: () => undefined }),
    ...(limits ? { limits } : {}),
    ...(heartbeatMs ? { heartbeatMs } : {}),
  });
  server = createServer();
  server.on('upgrade', collab.handleUpgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  close = () => {
    collab.close();
    server.close();
  };
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/rooms`;
};

const join = (url: string, room = ROOM) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, room, doc, { WebSocketPolyfill: WebSocket as never });
  providers.push(provider);
  return { doc, provider };
};

/** Waits for a condition the network makes true (no fixed sleeps). */
const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const synced = (p: WebsocketProvider) => until(() => p.synced);

afterEach(() => {
  for (const p of providers.splice(0)) p.destroy();
  close();
});

describe('collaboration over WebSocket (M2-04)', () => {
  it('an edit in one tab reaches the other', async () => {
    const url = await start();
    const a = join(url);
    const b = join(url);
    await Promise.all([synced(a.provider), synced(b.provider)]);

    a.doc.getMap('nodes').set('api', 'Orders API');

    await until(() => b.doc.getMap('nodes').get('api') === 'Orders API');
  });

  it('someone joining later gets the whole board', async () => {
    const url = await start();
    const a = join(url);
    await synced(a.provider);
    a.doc.getMap('nodes').set('api', 'Orders API');
    a.doc.getMap('nodes').set('db', 'Postgres');

    const late = join(url);
    await synced(late.provider);
    await until(() => late.doc.getMap('nodes').size === 2);
  });

  it('two rooms don’t see each other', async () => {
    const url = await start();
    const a = join(url, ROOM);
    const other = join(url, OTHER_ROOM);
    await Promise.all([synced(a.provider), synced(other.provider)]);

    a.doc.getMap('nodes').set('api', 'Orders API');
    const b = join(url, ROOM);
    await until(() => b.doc.getMap('nodes').size === 1); // the room has it…

    expect(other.doc.getMap('nodes').size).toBe(0); // …the other room never got it
  });

  it('presence is shared, and removed when someone leaves', async () => {
    const url = await start();
    const a = join(url);
    const b = join(url);
    await Promise.all([synced(a.provider), synced(b.provider)]);

    a.provider.awareness.setLocalStateField('user', { name: 'Guest 42' });
    const seesA = () =>
      [...b.provider.awareness.getStates().values()].some(
        (s) => (s as { user?: { name: string } }).user?.name === 'Guest 42',
      );
    await until(seesA);

    a.provider.destroy();
    await until(() => !seesA());
  });

  it('refuses a malformed room id', async () => {
    const url = await start();
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${url}/not-a-room`);
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(1008);
  });

  it('refuses one person too many', async () => {
    const url = await start({ maxRooms: 10, maxPeoplePerRoom: 1, maxMessageBytes: 1024 * 1024 });
    const a = join(url);
    await synced(a.provider);
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${url}/${ROOM}`);
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(1013);
  });

  it('closes a connection that sends a message over the limit', async () => {
    const url = await start({ maxRooms: 10, maxPeoplePerRoom: 5, maxMessageBytes: 1024 });
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${url}/${ROOM}`);
      ws.on('open', () => ws.send(new Uint8Array(4096)));
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(1009);
  });

  it('closes a connection that sends a message it can’t even read', async () => {
    const url = await start();
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${url}/${ROOM}`);
      ws.on('open', () => ws.send(new Uint8Array([0x80]))); // a number cut off mid-way
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(1003);
  });

  it('a corrupt update doesn’t break the room for everyone else', async () => {
    const url = await start();
    const a = join(url);
    await synced(a.provider);
    const ws = new WebSocket(`${url}/${ROOM}`);
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(new Uint8Array([0, 2, 5, 200, 200, 200, 200, 200])); // "an update" of garbage
    ws.close();

    a.doc.getMap('nodes').set('api', 'still here');
    const b = join(url);
    await until(() => b.doc.getMap('nodes').get('api') === 'still here');
  });

  it('someone joining later sees who is already there', async () => {
    const url = await start();
    const a = join(url);
    await synced(a.provider);
    a.provider.awareness.setLocalStateField('user', { name: 'Guest 7' });
    await new Promise((r) => setTimeout(r, 50)); // let the presence reach the server

    const late = join(url);
    await until(() =>
      [...late.provider.awareness.getStates().values()].some(
        (s) => (s as { user?: { name: string } }).user?.name === 'Guest 7',
      ),
    );
  });

  it('drops a connection that stops answering pings (a laptop closed mid-session)', async () => {
    const url = await start(undefined, 30);
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${url}/${ROOM}`, { autoPong: false });
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(1006); // terminated, no closing handshake
  });

  it('a full server makes room by dropping the room empty the longest', async () => {
    const url = await start({ maxRooms: 1, maxPeoplePerRoom: 5, maxMessageBytes: 1024 * 1024 });
    const a = join(url, ROOM);
    await synced(a.provider);
    a.doc.getMap('nodes').set('api', 'Orders API');
    await new Promise((r) => setTimeout(r, 50));
    a.provider.destroy();
    await new Promise((r) => setTimeout(r, 50));

    const other = join(url, OTHER_ROOM); // the only slot goes to the new room
    await synced(other.provider);
    other.provider.destroy();
    await new Promise((r) => setTimeout(r, 50));
    const back = join(url, ROOM); // the first room was dropped: it starts empty
    await synced(back.provider);
    expect(back.doc.getMap('nodes').size).toBe(0);
  });

  it('reports rooms, people and messages as metrics', async () => {
    const reader = new TestReader();
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    const url = await start();
    const a = join(url);
    await synced(a.provider);

    const { resourceMetrics } = await reader.collect();
    const points = Object.fromEntries(
      resourceMetrics.scopeMetrics
        .flatMap((s) => s.metrics)
        .map((m) => [m.descriptor.name, m.dataPoints[0]?.value]),
    );
    expect(points).toMatchObject({ collab_rooms: 1, collab_connections: 1 });
    expect(points.collab_messages_total).toBeGreaterThan(0);
  });

  it('answers 404 to any other WebSocket path', async () => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve) => {
      const ws = new WebSocket(url.replace('/ws/rooms', '/ws/other'));
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('error', () => resolve(undefined));
    });
    expect(status).toBe(404);
  });
});
