import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createConnectionStore } from '../store/connectionStore.ts';
import { connectRoom, type RoomProvider } from './connectRoom.ts';

/** A provider we can drive: the real one needs a server (covered by the e2e journeys). */
const fakeProvider = () => {
  const onStatus: ((event: { status: string }) => void)[] = [];
  const onSync: ((synced: boolean) => void)[] = [];
  let destroyed = false;
  let connected = true;
  const provider: RoomProvider = {
    on: ((event: 'status' | 'sync', handler: never) => {
      if (event === 'status') onStatus.push(handler);
      else onSync.push(handler);
    }) as RoomProvider['on'],
    awareness: new Awareness(new Y.Doc()),
    connect: () => {
      connected = true;
    },
    disconnect: () => {
      connected = false;
    },
    destroy: () => {
      destroyed = true;
    },
  };
  const emit = (status: string) => {
    for (const h of onStatus) h({ status });
  };
  const sync = (synced: boolean) => {
    for (const h of onSync) h(synced);
  };
  return { provider, emit, sync, isDestroyed: () => destroyed, isConnected: () => connected };
};

const setup = () => {
  const fake = fakeProvider();
  const store = createConnectionStore();
  const calls: { url: string; room: string; doc: Y.Doc }[] = [];
  const doc = new Y.Doc();
  let networkHandler: (online: boolean) => void = () => undefined;
  let watching = false;
  const { leave } = connectRoom({
    doc,
    roomId: 'k3x9a2b7q1zm',
    location: { protocol: 'https:', host: 'designroom.example' },
    store,
    createProvider: (url, room, d) => {
      calls.push({ url, room, doc: d });
      return fake.provider;
    },
    network: {
      onChange: (handler) => {
        networkHandler = handler;
        watching = true;
        return () => {
          watching = false;
        };
      },
    },
  });
  const network = (online: boolean) => networkHandler(online);
  return { fake, store, calls, doc, leave, network, isWatching: () => watching };
};

describe('connecting to a room (M2-05)', () => {
  it('opens the room’s WebSocket on this host, wss on https', () => {
    const { calls, doc } = setup();
    expect(calls).toEqual([
      { url: 'wss://designroom.example/ws/rooms', room: 'k3x9a2b7q1zm', doc },
    ]);
  });

  it('starts as connecting, then follows the provider', () => {
    const { fake, store } = setup();
    expect(store.getState().status).toBe('connecting');
    fake.emit('connected');
    expect(store.getState().status).toBe('connected');
    fake.emit('disconnected');
    expect(store.getState().status).toBe('offline');
    fake.emit('connecting');
    expect(store.getState().status).toBe('connecting');
  });

  it('knows when the room’s board has arrived', () => {
    const { fake, store } = setup();
    expect(store.getState().loaded).toBe(false);
    fake.sync(false);
    expect(store.getState().loaded).toBe(false);
    fake.sync(true);
    expect(store.getState().loaded).toBe(true);
  });

  it('says Offline as soon as the browser loses the network, and reconnects when it’s back', () => {
    const { fake, store, network } = setup();
    fake.emit('connected');

    network(false);
    expect(store.getState().status).toBe('offline');
    expect(fake.isConnected()).toBe(false);

    network(true);
    expect(fake.isConnected()).toBe(true);
  });

  it('leaving stops watching the network', () => {
    const { leave, isWatching } = setup();
    leave();
    expect(isWatching()).toBe(false);
  });

  it('remembers the room id for the link', () => {
    const { store } = setup();
    expect(store.getState().roomId).toBe('k3x9a2b7q1zm');
  });

  it('leaving closes the connection', () => {
    const { fake, leave } = setup();
    leave();
    expect(fake.isDestroyed()).toBe(true);
  });
});
