import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { Peer, PeerSession, SyncRoom } from '../application/rooms.ts';

// One room's shared document, spoken over the y-websocket protocol (what the browser's
// `y-websocket` provider expects). Two kinds of message, each starting with its type:
//   sync      — step 1 "here is my state vector", step 2 "here is what you're missing", then
//               live updates. Every update one person sends is applied here and sent to all.
//   awareness — presence (name, colour, cursor): not saved, removed when the person leaves.

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

type PeerState = {
  peer: Peer;
  /** The presence entries (awareness client ids) this connection set, removed when it leaves. */
  clients: Set<number>;
};

export type YjsRoomDeps = {
  /** One protocol message handled (for the collab_messages_total metric). */
  onMessage?: () => void;
  /**
   * Largest document the room keeps growing (memory is the limit until M3 saves rooms). Past it
   * the room is read-only: edits are refused, the board can still be read.
   */
  maxDocBytes?: number;
  /** How often (in messages) the document's size is measured: encoding it isn't free. */
  measureEvery?: number;
};

/** A board of a few hundred boxes is tens of kB: 10 MB is far beyond honest use. */
const MAX_DOC_BYTES = 10 * 1024 * 1024;

export const createYjsRoom = ({
  onMessage,
  maxDocBytes = MAX_DOC_BYTES,
  measureEvery = 100,
}: YjsRoomDeps = {}): SyncRoom & { doc: Y.Doc } => {
  const doc = new Y.Doc();
  let messagesSinceMeasure = 0;
  let readOnly = false;
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // the server itself is not a person in the room
  const peers = new Set<PeerState>();

  const sendTo = (state: PeerState, message: Uint8Array) => {
    try {
      state.peer.send(message);
    } catch {
      state.peer.close(1011, 'send failed'); // a broken socket: it will leave on close
    }
  };
  const broadcast = (message: Uint8Array, except?: unknown) => {
    for (const state of peers) if (state !== except) sendTo(state, message);
  };

  // Every change to the document goes to everyone but its sender, who already has it (the
  // transaction's origin is the sender's PeerState, set when its message is read).
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(encoding.toUint8Array(encoder), origin);
  };
  doc.on('update', onUpdate);

  const onAwareness = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const changed = [...change.added, ...change.updated, ...change.removed];
    // Remember which entries this connection set, to remove them when it closes. A connection
    // can hold more than one person's entry: tabs of one browser share theirs over a
    // BroadcastChannel and the first tab to connect sends them all.
    const from = [...peers].find((state) => state === origin);
    if (from) {
      for (const id of [...change.added, ...change.updated]) from.clients.add(id);
      for (const id of change.removed) from.clients.delete(id);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    );
    broadcast(encoding.toUint8Array(encoder));
  };
  awareness.on('update', onAwareness);

  return {
    doc,
    join: (peer): PeerSession => {
      const state: PeerState = { peer, clients: new Set() };
      peers.add(state);

      // Start the handshake: our state vector, so the newcomer sends what we're missing...
      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(step1, doc);
      sendTo(state, encoding.toUint8Array(step1));
      // ...and who is already here.
      const present = [...awareness.getStates().keys()];
      if (present.length > 0) {
        const who = encoding.createEncoder();
        encoding.writeVarUint(who, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          who,
          awarenessProtocol.encodeAwarenessUpdate(awareness, present),
        );
        sendTo(state, encoding.toUint8Array(who));
      }

      return {
        receive: (data) => {
          onMessage?.();
          try {
            const decoder = decoding.createDecoder(data);
            const type = decoding.readVarUint(decoder);
            if (type === MESSAGE_SYNC) {
              const writes = decoding.peekVarUint(decoder) !== syncProtocol.messageYjsSyncStep1;
              if (readOnly && writes) {
                state.peer.close(1009, 'room is full');
                return;
              }
              const reply = encoding.createEncoder();
              encoding.writeVarUint(reply, MESSAGE_SYNC);
              // Step 1 from them → we answer with step 2; step 2 or an update → applied to doc.
              syncProtocol.readSyncMessage(decoder, reply, doc, state);
              if (encoding.length(reply) > 1) sendTo(state, encoding.toUint8Array(reply));
              if (writes && ++messagesSinceMeasure >= measureEvery) {
                messagesSinceMeasure = 0;
                readOnly = Y.encodeStateAsUpdate(doc).byteLength > maxDocBytes;
              }
            } else if (type === MESSAGE_AWARENESS) {
              awarenessProtocol.applyAwarenessUpdate(
                awareness,
                decoding.readVarUint8Array(decoder),
                state,
              );
            }
            // Other message types (auth, queries) are not used: ignored.
          } catch {
            // Not a message we can read: a broken or hostile client. Disconnect it, keep the room.
            state.peer.close(1003, 'unreadable message');
          }
        },
        leave: () => {
          peers.delete(state);
          awarenessProtocol.removeAwarenessStates(awareness, [...state.clients], null);
        },
      };
    },
    destroy: () => {
      for (const state of peers) state.peer.close(1001, 'room closed');
      peers.clear();
      doc.off('update', onUpdate);
      awareness.off('update', onAwareness);
      awareness.destroy();
      doc.destroy();
    },
  };
};
