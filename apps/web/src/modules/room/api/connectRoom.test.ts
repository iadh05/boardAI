import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createConnectionStore } from '../store/connectionStore.ts';
import { connectRoom, type RoomProvider } from './connectRoom.ts';

/** A provider we can drive: the real one needs a server (covered by the e2e journeys). */
const fakeProvider = () => {
  const handlers: Record<string, ((event: { status: string }) => void)[]> = {};
  let destroyed = false;
  const provider: RoomProvider = {
    on: (event, handler) => {
      (handlers[event] ??= []).push(handler);
    },
    destroy: () => {
      destroyed = true;
    },
  };
  const emit = (status: string) => {
    for (const h of handlers.status ?? []) h({ status });
  };
  return { provider, emit, isDestroyed: () => destroyed };
};

const setup = () => {
  const fake = fakeProvider();
  const store = createConnectionStore();
  const calls: { url: string; room: string; doc: Y.Doc }[] = [];
  const doc = new Y.Doc();
  const leave = connectRoom({
    doc,
    roomId: 'k3x9a2b7q1zm',
    location: { protocol: 'https:', host: 'designroom.example' },
    store,
    createProvider: (url, room, d) => {
      calls.push({ url, room, doc: d });
      return fake.provider;
    },
  });
  return { fake, store, calls, doc, leave };
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
