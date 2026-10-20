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
  /** The awareness client ids this person controls, removed when they leave. */
  clients: Set<number>;
};

export type YjsRoomDeps = {
  /** One protocol message handled (for the collab_messages_total metric). */
  onMessage?: () => void;
};

export const createYjsRoom = ({ onMessage }: YjsRoomDeps = {}): SyncRoom & { doc: Y.Doc } => {
  const doc = new Y.Doc();
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
  const broadcast = (message: Uint8Array) => {
    for (const state of peers) sendTo(state, message);
  };

  // Every change to the document, whoever made it, goes to everyone (the sender already has it,
  // and Yjs ignores updates it already applied).
  const onUpdate = (update: Uint8Array) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    broadcast(encoding.toUint8Array(encoder));
  };
  doc.on('update', onUpdate);

  const onAwareness = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const changed = [...change.added, ...change.updated, ...change.removed];
    // Remember which presence entries belong to which person, to remove them when they leave.
    // "updated" counts too: a closing client sends "removed" and then one last update of its own
    // entry, which would otherwise stay on everyone's screen after it left.
    for (const state of peers) {
      if (state !== origin) continue;
      for (const id of [...change.added, ...change.updated]) state.clients.add(id);
      for (const id of change.removed) state.clients.delete(id);
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
              const reply = encoding.createEncoder();
              encoding.writeVarUint(reply, MESSAGE_SYNC);
              // Step 1 from them → we answer with step 2; step 2 or an update → applied to doc.
              syncProtocol.readSyncMessage(decoder, reply, doc, state);
              if (encoding.length(reply) > 1) sendTo(state, encoding.toUint8Array(reply));
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
