# M2 — Multiplayer · Tickets

Spec: [docs/specs/M2-multiplayer.md](../docs/specs/M2-multiplayer.md) · Architecture: [docs/architecture.md](../docs/architecture.md)

**TDD rule for every ticket with logic:** tests first (red), then green, then refactor. Commit at each green.

| ID | Title | Part | Size | Status |
|---|---|---|---|---|
| M2-01 | Spec, tickets, ADR-010 (CRDT / Yjs) | docs | S | done |
| M2-02 | Board ↔ Yjs document: read with repair, write the difference | web | M | done |
| M2-03 | Board store on the document + undo / redo (own changes only) | web | M | done |
| M2-04 | Server `collaboration` module: rooms, sync protocol, limits | server | M | done |
| M2-05 | Rooms in the app: `/room/:id`, provider, status badge; Nginx and preview `/ws` | web + infra | M | done |
| M2-06 | Live cursors with names and colours | web + diagram | M | done |
| M2-07 | Two-tab Playwright journeys (live edit, same-box drag, offline, undo) | e2e | M | done |
| M2-08 | Checkpoint, decisions, retro | close | S | doing |

---

## M2-01 — Spec, tickets, ADR-010
**Status:** done (#57) · **Size:** S

**Tasks**
- [ ] Spec and these tickets.
- [ ] ADR-010 in `docs/decisions.md`: CRDT vs "last write wins" vs OT; why Yjs; field-level maps.

---

## M2-02 — Board ↔ Yjs document
**Status:** done (#58) · **Size:** M · **Depends on:** M2-01

**Learning goal:** a CRDT merges; your app must still see a valid board.

**Tests first**
- `readBoard` on an empty doc → empty board; round trip `writeBoard(empty → board)` then `readBoard` → same board.
- Writing the difference touches only what changed (one renamed box → one field set).
- Two docs edited concurrently and synced both ways end equal: one renames a box while the other moves it → both changes kept.
- Concurrent delete of a box + new arrow to it → the arrow is hidden; two concurrent arrows A→B → one shown (lowest order, then id).
- An item that fails the schema (written by a buggy or hostile peer) is skipped, the rest is read.
- Order is the same on every copy.

---

## M2-03 — Board store on the document + undo / redo
**Status:** done (#59) · **Size:** M · **Depends on:** M2-02

**Tests first**
- Every existing store test still passes (actions unchanged).
- A change from another copy of the doc appears in the store.
- Undo reverts this store's last change, not a change that came from another copy; redo puts it back.
- A drag (many moves within half a second) is one undo step.
- A proposal accepted is one undo step.

**Tasks**
- [ ] Undo / Redo buttons in the toolbar; Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y (not while typing in a field).

---

## M2-04 — Server `collaboration` module
**Status:** done (#60) · **Size:** M · **Depends on:** M2-01

**Tests first** (real `ws` clients against the module on a random port, no network beyond localhost)
- Two clients in one room: an update from one reaches the other; a client joining later gets the whole document.
- Two rooms don't see each other.
- Awareness (presence) is relayed, and removed when a client leaves.
- Invalid room id → connection refused; 21st connection in a room → refused; message over 1 MB → connection closed.
- Room limit: the oldest empty room is dropped first; rooms with people are never dropped.

**Notes**
- Rooms in memory: lost on restart until M3.
- Metrics: `collab_connections` (gauge), `collab_rooms` (gauge), `collab_messages_total`.

---

## M2-05 — Rooms in the app
**Status:** done (#62) · **Size:** M · **Depends on:** M2-03, M2-04

**Tasks**
- [ ] `/` opens a new room (`/room/<id>`); `/room/:id` joins it; a malformed id opens a new room.
- [ ] `y-websocket` provider on `/ws/rooms/:id`; status badge (Connected / Connecting… / Offline).
- [ ] "Copy link" button.
- [ ] Nginx: `/ws/` → server, with upgrade headers and a long read timeout; edge smoke test covers it.
- [ ] `vite preview` forwards `/ws` (e2e).

---

## M2-06 — Live cursors
**Status:** done (#63) · **Size:** M · **Depends on:** M2-05

**Tasks**
- [ ] `@designroom/diagram`: `onPointerMove(position | null)` in diagram coordinates, and an overlay that draws children at diagram coordinates.
- [ ] Awareness: name ("Guest 42"), colour from a fixed palette, cursor; sent at most ~20 times a second.
- [ ] Other people's cursors with their name; gone when they leave. People count next to the badge.

---

## M2-07 — Two-tab Playwright journeys
**Status:** done (#64) · **Size:** M · **Depends on:** M2-05, M2-06

- Tab A adds and renames a box → tab B sees it.
- Both tabs drag the same box at once → both end in the same place.
- Tab B goes offline, edits, comes back → tab A gets the edit.
- Undo in tab A doesn't undo tab B's edit.
- Tab B sees tab A's cursor.

---

## M2-08 — Checkpoint and retro
**Status:** doing · **Size:** S

- [ ] `docs/checkpoints/M2.md`: demo steps, numbers (update size, message rate while dragging), what's left for M3.
- [ ] Tick M2 in MILESTONES; update PROGRESS.
