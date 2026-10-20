import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createPresenceStore } from '../store/presenceStore.ts';
import { identityFor, startPresence } from './presence.ts';

/** Two people's presence, linked as the server would relay it. */
const twoPeople = () => {
  const a = new awarenessProtocol.Awareness(new Y.Doc());
  const b = new awarenessProtocol.Awareness(new Y.Doc());
  const relay = (from: awarenessProtocol.Awareness, to: awarenessProtocol.Awareness) =>
    from.on('update', ({ added, updated, removed }: Record<string, number[]>) => {
      const changed = [...(added ?? []), ...(updated ?? []), ...(removed ?? [])];
      awarenessProtocol.applyAwarenessUpdate(
        to,
        awarenessProtocol.encodeAwarenessUpdate(from, changed),
        'relay',
      );
    });
  relay(a, b);
  relay(b, a);
  return { a, b };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('who is here (M2-06)', () => {
  it('a name and a colour for each person, the same on every screen', () => {
    expect(identityFor(1234567)).toEqual({ name: 'Guest 67', color: 7 });
    expect(identityFor(1234567)).toEqual(identityFor(1234567));
  });

  it('each person sees the others, with their cursor, not themselves', () => {
    const { a, b } = twoPeople();
    const storeA = createPresenceStore();
    const storeB = createPresenceStore();
    const presenceA = startPresence({ awareness: a, store: storeA });
    startPresence({ awareness: b, store: storeB });

    presenceA.setCursor({ x: 10, y: 20 });
    vi.advanceTimersByTime(100); // awareness keeps its own timer: never "run all"

    expect(storeB.getState().others).toEqual([
      { id: a.clientID, ...identityFor(a.clientID), cursor: { x: 10, y: 20 } },
    ]);
    expect(storeA.getState().others.map((p) => p.id)).toEqual([b.clientID]);
    expect(storeA.getState().me).toEqual(identityFor(a.clientID));
  });

  it('sends the cursor at most every 50 ms, ending on the last position', () => {
    const { a, b } = twoPeople();
    const presence = startPresence({ awareness: a, store: createPresenceStore() });
    let sent = 0;
    a.on('update', () => sent++);

    for (let x = 0; x < 30; x++) presence.setCursor({ x, y: 0 });
    vi.advanceTimersByTime(60);

    expect(sent).toBeLessThanOrEqual(3);
    const state = b.getStates().get(a.clientID) as { cursor?: unknown } | undefined;
    expect(state?.cursor).toEqual({ x: 29, y: 0 });
  });

  it('a pointer leaving the board hides the cursor for the others', () => {
    const { a, b } = twoPeople();
    const storeB = createPresenceStore();
    const presence = startPresence({ awareness: a, store: createPresenceStore() });
    startPresence({ awareness: b, store: storeB });
    presence.setCursor({ x: 1, y: 1 });
    presence.setCursor(null);
    vi.advanceTimersByTime(100);
    expect(storeB.getState().others[0]?.cursor).toBeNull();
  });

  it('ignores what a buggy or hostile client puts in its presence', () => {
    const { a, b } = twoPeople();
    const storeB = createPresenceStore();
    startPresence({ awareness: b, store: storeB });

    a.setLocalState({ user: { name: 'x'.repeat(500), color: 99 }, cursor: { x: 'left', y: 1 } });

    const [person] = storeB.getState().others;
    expect(person?.name.length).toBeLessThanOrEqual(40);
    expect(person?.color).toBeLessThan(8);
    expect(person?.cursor).toBeNull();
  });

  it('someone leaving disappears', () => {
    const { a, b } = twoPeople();
    const storeB = createPresenceStore();
    startPresence({ awareness: a, store: createPresenceStore() });
    startPresence({ awareness: b, store: storeB });
    expect(storeB.getState().others).toHaveLength(1);

    a.setLocalState(null); // what a closing tab does
    expect(storeB.getState().others).toEqual([]);
  });
});
