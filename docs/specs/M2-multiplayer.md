# M2 — Multiplayer

> Status: written overnight 2026-10-20 by Claude on the owner's go ("M2 is clear, complete it") — **for review**
> Depends on: M1 (board, store, server, Nginx)
> Architecture: [docs/architecture.md](../architecture.md) · Tickets: [tickets/M2-multiplayer.md](../../tickets/M2-multiplayer.md)

## 1. Goal

Two tabs (or two people) edit the same board live, like Google Docs. Each board is a **room** with its own link. Everyone sees the others' cursors, edits made offline sync when the connection comes back, and **undo only undoes your own changes**.

**Done when:** two tabs open the same room link, drag the same box at the same time, and both end with the box in the same place, with no errors. A Playwright test does it.

## 2. What you'll learn

- **CRDTs** — why two people editing at once can't be solved with "last write wins" on the whole board, and how a CRDT merges edits so every copy ends the same, in any order, with no server deciding.
- **Yjs** — documents, shared maps, transactions, updates, origins.
- **A sync protocol** — the two-step handshake (state vectors: "here's what I have, send me what I'm missing"), then live updates; presence ("awareness") as a separate, throwaway channel.
- **A stateful server** — the first part of the app that keeps state in memory, and the limits it needs (rooms, connections, message size).
- **Offline-first** — the local copy is the truth for the user; the network only exchanges updates.

## 3. Decisions

| Area | Choice | Why |
|---|---|---|
| Sync | **Yjs** (CRDT) | The most used CRDT for the web; proven; small updates; awareness built in. ADR-010. |
| Document layout | Three `Y.Map`s: `nodes`, `edges`, `zones`; each item is a `Y.Map` of its fields | Field-level merge: one person renames a box while another moves it → both changes stay. Whole-object values would drop one. |
| Order | Each item stores `order` (a number, set when added); read sorted by `order`, then id | `Y.Map` has no order; every copy must list boxes the same way (the AI's `n1, n2…` come from it) |
| Rules | The store's actions stay the same: the domain op runs on the current board, and the **difference** is written to the document in one transaction | Every rule still lives in `@designroom/domain`; components don't change (architecture §5.3) |
| Repair on read | Items that fail the zod schema are skipped; an arrow whose box was deleted at the same time, and a second arrow for the same connection, are hidden | Two valid edits can make an invalid board together (A deletes a box while B connects to it). The board the app sees is always valid. |
| Local only | AI proposal, ghost placements, label being edited, chat | The AI is per person until M4 ("agent in the room") |
| Undo | `Y.UndoManager`, tracking only this tab's changes; Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, toolbar buttons | Undo must never remove someone else's work |
| Server | New `collaboration` module; a small sync server written on `y-protocols` (sync + awareness) and `ws` | The protocol stays visible and tested; the packaged server `@y/websocket-server` is 0.1.x. The client is the standard `y-websocket` provider. |
| Rooms | URL `/room/:id`; `/` opens a new room. Ids: 12 random characters (`[a-z0-9]`, ~62 bits) | A link is the access in M2 (like an unlisted doc); auth comes in A5 |
| Storage | **In memory** on the server: a room lives until the server restarts | Persistence is M3 |
| Limits | Max 100 rooms (oldest empty room dropped first), 20 connections per room, 1 MB per message; invalid room id → refused | The server now holds state: unbounded memory is a way to take it down |
| Transport | WebSocket on `/ws/rooms/:id`; Nginx forwards `/ws/` with the upgrade headers; `vite preview` forwards it for e2e | One origin, as for `/api` |
| Presence | Awareness: a name ("Guest 42"), a colour from a fixed palette, the cursor in diagram coordinates | Cursors stay on the right box at any zoom |
| Status | Badge: Connected / Connecting… / Offline | The user must know whether others see their edits |
| Offline | Edits always apply locally; the provider sends what's missing on reconnect | No IndexedDB in M2: a reload while offline loses unsent edits (noted, M3 or later) |

## 4. What stays the same

- `packages/domain`: unchanged. The agent, the chat and the server's chat module: unchanged (the chat still sends the board it sees).
- `packages/diagram`: gains two generic things only — the pointer position on the diagram, and an overlay drawn at diagram coordinates (for cursors). It still knows nothing about users or rooms.

## 5. Out of scope

Saving rooms (M3), several server instances (M3), the AI as a room member (M4), auth and roles (A5), offline across reloads.
