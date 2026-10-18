# Architecture — brainstorm notes

> Status: brainstorm, not final. We turn this into `architecture.md` once the open questions are answered.

> **2026-10-17:** stack and M1 design decided → see [architecture.md](architecture.md). pnpm, React + Vite + Tailwind, React Flow, Hono, local Qwen via Ollama, TDD. AI pulled into M1 as a single-user reviewer that proposes changes.
> Then: FE modules → pods (components/hooks/mappers), atomic design (atoms only in `core/ui`), promotion on 2nd use into named folders (no `shared/`), Zustand + React Query (no Redux), modules `board` and `chat` (chat → board), BE modular monolith with four layers, packages `domain` / `agent` / `ai-gateway`, Sentry + OpenTelemetry/Grafana, lint-enforced boundaries.

## Approach

- **One problem at a time.** Start with one person (M1), then add multiplayer, then scale. Don't design details for milestones we haven't reached.
- **Exception:** decide *now* only the things that are expensive to change later:
  - board model = our own types, not React Flow's
  - node ids = unique random ids (`crypto.randomUUID()`)
  - board stored as data, not SVG
- Everything else stays in "Open questions" until its milestone.

## Components (draft)

| Component | Role | Notes |
|---|---|---|
| Browser app | React + React Flow. Has its **own full copy** of the board (Yjs). | Served as static files from a CDN. |
| Load balancer / proxy | Routes connections to server instances. | Must support WebSocket upgrade + long-lived connections. |
| Sync server | Node + WebSocket. Holds one `Y.Doc` per active room in RAM. | Can run as several instances (M3). |
| Database | Permanent storage of boards. | Postgres in M3. |
| Redis pub/sub | Passes updates between server instances. | M3. |
| AI agent | Runs **server side**: secret API key, browser can't be trusted, cost limit counted in one place. | Browser only **displays** its work: chat, ghost nodes, Accept/Reject. |
| Simulation | Runs **in the browser**. | No server cost; it's the user's experiment. |

## Decided (tentative)

- **Sync model:** every browser has a full copy + the server has a copy; copies merge with a CRDT (Yjs). → Offline editing works.
- **Scaling:** Strategy 1 (any instance + Redis pub/sub between instances) in M3. Strategy 2 (room → always same instance) later in G9.
- **Store data, display SVG.** Nodes and edges are stored as structured data (Yjs binary in the DB). The screen renders SVG/HTML from that data. SVG is only a **generated** artifact (thumbnails, embeds), never the source of truth.
  - Why: data is ~8–10× smaller than SVG, merges safely in Yjs, and the agent / simulator / infra export can understand it.

## What we store

Two separate questions: is it **shared** with others? Is it **stored** permanently?

|  | Stored | Not stored |
|---|---|---|
| **Shared** | nodes, edges, node properties, chat | cursors, who's online |
| **Not shared** | user preferences (name, colour) | my zoom, my selection |

| # | Item | Decision | Lives in |
|---|---|---|---|
| 1 | Nodes and edges | Permanent | `Y.Doc` → DB |
| 2 | Other users' cursors | Temporary | Yjs awareness |
| 3 | Who's online | Temporary | Yjs awareness |
| 4 | My selection | Local (could become Temporary if we show others' selections, like Figma) | React state |
| 5 | My zoom | Local | React state |
| 6 | Agent chat | Permanent | `Y.Doc` or separate table — to decide |
| 7 | Rejected agent proposal | Permanent — **reason to discuss** | ? |
| 8 | Simulation settings | Permanent (node capacity etc. is part of the design) | `Y.Doc` |
| 9 | Simulation results | Not stored — **derived**: recompute from settings + seed | memory |
| 10 | Undo stack | Local, per user, per session | `Y.UndoManager` in memory |
| — | Version history (≠ undo) | Permanent — later, A2 | Yjs update log |

**Principle:** store the source, derive the output (simulation results, SVG).

## Performance plan

| Goal | Answer |
|---|---|
| Smaller DB | Store data (Yjs binary) + **compaction** (merge update log into a snapshot, M3) + compression |
| Faster page load | CDN + browser caching of the JS bundle; **local copy in the browser** (`y-indexeddb`) so the board shows instantly then syncs the diff; SVG thumbnails for board lists |
| Note | Board data (~5 KB) is not the page-load bottleneck; the JS bundle (~200–400 KB) is |

## Parked for M3 — work on these during implementation

- Redis topology: single instance in M3 (single point of failure, accepted). Managed Azure Cache for Redis in M6.
- Pub/sub forgets messages → if one is lost, instances resync with Yjs **state vectors**.
- Pub/sub forgets messages → **saving to the DB can't rely on it**. Decide which component saves.
- Why Redis and not Postgres `LISTEN/NOTIFY`: every drag sends several updates/sec; pushing them all through the database would load the DB that's also busy saving boards. A dedicated pipe keeps the DB free.
- WebSocket ops: heartbeats (ping/pong), client reconnect with backoff + jitter, proxy idle timeouts.

## Open questions (next brainstorm sessions)

1. **(M2)** How the `Y.Doc` is organised inside. Leaning: nodes = `Y.Map<id, Y.Map>` (one register per field, so a rename and a move don't overwrite each other). Edges and chat still to decide. Why keep rejected proposals (#7)?
2. Server: dumb relay vs smart server vs "agent can only write through a narrow door".
3. Agent: exactly how it reads the board and makes proposals.
4. Simulation shared live: share the **inputs** (settings + random seed) or share the **results**?
5. M2 server: start with y-websocket and build M3 parts ourselves, or use Hocuspocus? (not answered yet)
