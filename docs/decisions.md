# Architecture Decision Records

Short, dated records of decisions that would be expensive to reverse. Newest at the bottom. Never edit an accepted ADR's decision — supersede it with a new one.

Each milestone spec lists the ADRs it expects. Write them **when you make the decision**, not at the end.

## Template

```markdown
## ADR-NNN — <Title>
- **Date:** YYYY-MM-DD
- **Status:** proposed | accepted | superseded by ADR-NNN
- **Milestone:** M1

### Context
What problem forced a decision? What constraints matter?

### Options considered
1. Option A — pros / cons
2. Option B — pros / cons

### Decision
What we chose, in one sentence.

### Consequences
What gets easier, what gets harder, what we'll need to revisit.
```

---

<!-- ADRs go below this line -->

## ADR-001 — React Flow for the diagram canvas

- **Date:** 2026-10-17 (recorded 2026-10-18, after M1a)
- **Status:** accepted
- **Milestone:** M1

### Context

The board needs pan and zoom, draggable nodes, arrows between nodes, selection, keyboard delete and a minimap. Building that well is a project of its own, and the goal of DesignRoom is the system-design features on top (AI reviewer, multiplayer, simulation).

### Options considered

1. **Build our own** on SVG or `<canvas>`: full control, but every interaction (hit-testing, dragging, zoom maths, edge routing) is ours to write and debug.
2. **tldraw / Excalidraw**: great free-form whiteboards, but they think in shapes and strokes, not in a graph of nodes and edges.
3. **React Flow (`@xyflow/react`)**: a graph editor for React. Nodes and edges are its model, and nodes are plain React components.

### Decision

Use React Flow: a popular, well-tested library instead of building our own, which would be buggier.

### Consequences

- **Easier:** pan, zoom, drag, connect, select, delete and minimap came almost for free in M1-09 to M1-12, with 100 nodes at 60 fps. Nodes are our own React components (icon, label editor).
- **Worse at:** it is a DOM renderer, so it hides each node until it has measured it. That caused a real bug: the new Custom node's input couldn't take focus (M1-11). It also means unit tests in jsdom need workarounds. Connecting nodes is mouse-only, with no keyboard way to draw an arrow, which is an accessibility gap.
- **Revisit:** at 5,000+ nodes (A5) or with a GPU renderer (G3), the DOM approach hits its limit. Because the board model is our own (ADR-002), only the `toFlow` mapper and the canvas pod would change.

## ADR-002 — Our own board model: data, not SVG

- **Date:** 2026-10-17
- **Status:** accepted
- **Milestone:** M1

### Context

We have to decide what "a board" *is*: what gets stored, sent to the AI, and later synced between users.

### Options considered

1. **Store the drawing (SVG):** what you see is what you save. But it's large, and you can't ask "which nodes connect to the API?" without parsing a picture.
2. **Store React Flow's objects:** no translation, but they mix our data with view state (selection, measured size, styles) and tie the format to one library.
3. **Our own model in `@designroom/domain`:** `{ nodes: { id, kind, label, position }[], edges: { id, source, target }[] }`, validated with zod, plus pure operations (`addNode`, `connect`, `applyOps`…).

### Decision

Keep the board as our own small data model, because it's better for storage (less in the database) and easy to use in multiplayer.

### Consequences

- **Easier:**
  - The same model and rules run in the browser, on the server and in the agent.
  - The AI gets a compact text version of the board, not pixels.
  - In M2 each node becomes a `Y.Map` in Yjs, and only data changes are synced.
- **Harder:** we need a mapper (`toFlow`) between our model and React Flow, and a few rules exist in both places on purpose. Example: `canConnect` gives live feedback while dragging, and the store checks it again on drop.
- **Revisit:** when nodes get simulation properties (A1), they go into this model, not into the view.

## ADR-003 — Front end: modules and pods, Zustand + React Query

- **Date:** 2026-10-17
- **Status:** accepted
- **Milestone:** M1

### Context

The web app will grow: board, chat, later rooms, simulation and voice. We need a structure that stays clear as features are added, and a way to hold client state (the board) and server state (chat requests, later rooms).

### Options considered

**Structure**

1. **Folders by file type** (`components/`, `hooks/`, `utils/`): simple at first, but every feature is spread over every folder.
2. **Modules → pods** (`modules/board/pods/canvas|toolbar|node`): each feature is an island with its own components, hooks, mappers and store. Code moves up a level only when a second place needs it (promotion), and lint enforces the boundaries.

**State**

1. **Redux (Toolkit):** proven, but a lot of boilerplate for what we need.
2. **Jotai:** fine-grained atoms, but state is spread over many atoms. Subscribing from outside React (needed for the chat module now and a Yjs binding later) goes through a separate store object (`createStore`, `store.sub`) per atom, where Zustand has one `subscribe` per module store.
3. **Zustand + React Query:**
   - Zustand is one small store per module, with selectors, and is readable and subscribable outside React (`getState`, `subscribe`).
   - React Query handles server state: caching, refetching and request status.

### Decision

Modules and pods, by preference, for better scalability. Zustand for client state and React Query for server state: a better combination than Jotai (subscriptions) or Redux (boilerplate), with React Query giving better caching and server-state management.

### Consequences

- **Easier:**
  - Each pod stays small and testable.
  - Stores are created by a factory, so every test gets a fresh one.
  - In M2 the store's actions can write to Yjs without components noticing.
- **Harder:**
  - Pods that must cooperate need a shared place. The toolbar telling the node pod "edit this new Custom node" put `editingNodeId` into the module store.
  - React Flow renders node components itself, so they reach the store through a small context (`BoardStoreContext`).
  - More folders and `index.ts` files than a flat app.
- **Revisit:** at the end of M1, decide whether `core/ui` becomes a design-system package and whether some modules become packages (planned in M1-27).

## ADR-004 — The diagram as our own package: React Flow + libavoid behind `@designroom/diagram`

- **Date:** 2026-10-18
- **Status:** accepted (extends ADR-001: React Flow stays, now behind our own package)
- **Milestone:** M1

### Context

After M1a the board read like a flowchart, not an architecture diagram (draw.io / AWS style): one box style, handles only left and right, curvy edges, no labels or zones. A spike (`spike/canvas-engines`, `spikes/canvas/README.md`) drew the same architecture board with **React Flow + libavoid-js** and with **AntV X6**.

### Options considered

1. **Keep React Flow as it is:** cheapest, but no routing around boxes, so it never looks like draw.io.
2. **AntV X6:** the cleanest arrows out of the box (manhattan router), less code, stable and MIT. But it has an imperative API, and its behaviour can only be checked in a real browser: no component tests in jsdom, no routing tests without a browser. Its docs are partly Chinese-only. 167 KB gzip.
3. **React Flow + libavoid-js (orthogonal routing compiled to wasm):** keeps the store-driven canvas and its tests. libavoid-js ships a Node build, so routing quality can be unit-tested. Risks: libavoid-js is a beta (0.5.0-beta.5) with out-of-date typings; routes need tuning; 184 KB wasm (lazy, cached per version); LGPL.
4. **Our own canvas:** weeks to months of hit-testing, zoom, routing and accessibility before reaching today's features. The roadmap keeps it for G3.
5. **Embed draw.io (iframe):** we'd lose our board model, so no AI ghost nodes and no Yjs multiplayer.

**Cross-cutting choice: put the canvas in our own package**, used by the app like a third-party library. The app never imports the engine, so the engine can be swapped later without touching the app (the same idea as `ai-gateway` for LLMs).

### Decision

React Flow + libavoid-js, behind `@designroom/diagram`. We chose it because the project is test-driven: almost all diagram behaviour, routing included, can be tested without a browser, and libavoid's risks stay inside one adapter file with a fallback.

### Consequences

- **The package knows nothing about DesignRoom.** No `@designroom/*` imports (lint-enforced). It speaks boxes, arrows, shapes and zones. Its stylesheet is themed with CSS variables, and React is a peer dependency.
- **The app maps its concepts onto it:** kind → shape, colour and icon. Store callbacks stay in the board module.
- **Easier:** draw.io-style look; routing is tested in Node; the engine can be swapped behind a stable API.
- **Harder:** two libraries kept in sync inside the package (React Flow positions → libavoid obstacles); a wasm to load and cache; route tuning.
- **Exit condition:** if libavoid's routes still look clearly worse than X6's after about a day of tuning, or the beta breaks, replace the router or engine *inside* the package (X6 is the documented fallback). The app does not change.

## ADR-005 — Zones (VPC, region, …) are shapes; membership comes from position

- **Date:** 2026-10-18
- **Status:** accepted
- **Milestone:** M1

### Context

Solution-architecture diagrams group boxes into zones: Region ⊃ VPC ⊃ Subnet, "Backend services", "3rd party". We need them on the board, for people and for the AI ("your database sits outside the VPC"). In M2 the board becomes a shared Yjs document.

### Options considered

1. **Parent pointer** (`node.parentId`, React Flow's model): containment is explicit, and children move with the parent. But positions become relative to the parent, and two people dragging the same box into two zones at once is a re-parenting conflict that Yjs must resolve.
2. **Zones as their own shapes:** `board.zones: [{ id, label, x, y, width, height }]`, and boxes keep absolute positions. "Is the API in the VPC?" is computed from the rectangles. This is how draw.io's containers behave.

### Decision

Zones are shapes, and membership comes from position.

### Consequences

- **Easier:**
  - No re-parenting, so in M2 a zone is just another shared shape.
  - Nested zones are rectangles inside rectangles.
  - The domain computes `zonesOf(box)` for the UI and the AI.
- **Harder:**
  - Moving a zone has to move the boxes inside it: one op (`moveZone`) does both, so it stays one update and one undo step in M2.
  - A box half-inside a zone needs a rule: it counts as inside when its whole rectangle is.

## ADR-010 — Real-time sync with a CRDT (Yjs), merged field by field

- **Date:** 2026-10-20
- **Status:** proposed (written overnight on the owner's go; for review)
- **Milestone:** M2

### Context

In M2 several people edit one board at the same time, with network delays and short offline periods. Each copy must end identical, without losing anyone's edit, and the board must stay a valid graph.

### Options considered

1. **Last write wins on the whole board:** each client sends its full board, the server keeps the latest. Simple, but two people editing at once lose one person's work every time.
2. **Operational transformation (OT, Google Docs' original approach):** a central server transforms concurrent operations against each other. Correct, but the transform rules for a graph (move vs delete vs connect) are ours to write and prove, and offline editing is hard.
3. **A CRDT (Yjs):** every copy applies updates in any order and converges; no server decision needed; offline works by design. Mature, small binary updates, presence ("awareness") included. Alternatives: Automerge (heavier, slower for this size), our own CRDT (G1, later, as a learning exercise).

### Decision

Yjs. The board is three `Y.Map`s (`nodes`, `edges`, `zones`); each item is a `Y.Map` of its fields, so concurrent edits to different fields of the same box both survive. Domain ops stay the source of rules: the store computes the next board with them and writes only the difference. Reading repairs what two valid edits can break together (an arrow to a box deleted at the same time; two arrows for the same connection).

### Consequences

- **Easier:** live edits, offline edits and undo of only your own changes (`Y.UndoManager` with tracked origins) come from the library.
- **Harder:** the document can briefly hold a state no single op would produce, so the read side must repair it; the server becomes stateful (rooms in memory until M3); binary updates are not human-readable in logs.
- **Same field, same time:** the last write (in Yjs order) wins for that field — two people dragging the same box end at one of the two positions, the same on every screen.

## ADR-011 — The agents run on our own state graph, shaped like LangGraph

- **Date:** 2026-10-22
- **Status:** accepted (the owner, 2026-10-22)
- **Milestone:** M1c (agent V2)

### Context

V2 (`reviewerV2.ts`, AV2-05 … AV2-09) runs the agents as a straight line of steps with a task queue and no saved state. That is enough for one review that runs start to finish, not for what comes next:

- **Pause and resume:** the Planner asks you a question, or an ad-hoc expert (D17) waits for your Accept. Today the request ends and the next message starts from nothing.
- **Decisions at runtime:** the Planner decides how many tasks and sub-briefs to run (D10, AV2-13).
- **Visibility:** you should see where each agent is ("Security ✓ · Cost running · 2 left", D6), and a failed run should be replayable step by step.

These are exactly what LangGraph is built around: a typed state, nodes and conditional edges, a checkpoint after each step, `interrupt()` to pause for a human, and streamed events. The owner's direction (2026-10-21, again 2026-10-22): **build it ourselves, without LangGraph, using the same ideas.**

### Options considered

1. **LangGraph.js** (`@langchain/langgraph`) — mature: checkpointers, interrupts, `Send` for fan-out, streaming modes, LangGraph Studio. But it brings `@langchain/core` and its own way to call models next to our ai-gateway; we would learn its API more than the ideas.
2. **XState** — very good state machines and a visual inspector. Not made for LLM agents: checkpoints, streaming to the chat and the agent contracts would still be ours.
3. **Our own graph runtime, LangGraph-shaped** — a small TDD'd package: a typed state, nodes, conditional edges, a checkpointer, interrupts and an event stream, using LangGraph's names (`StateGraph`, `addNode`, `addConditionalEdges`, `interrupt`, `stream`). Fits our gateway, zod contracts, Phoenix spans and fake-LLM tests; we maintain it.

### Decision

Option 3: our own state graph with LangGraph's concepts and names, and **no LangGraph or LangChain dependency** — for the graph and for the context (D12 stays our own code). The owner's call, twice.

### Design (first version)

- **Three layers, kept apart (the owner, 2026-10-22):**
  1. **The orchestrator is two parts (the owner, 2026-10-22).** The **Planner** is its brain: an LLM (level 2, thinking) asked at every decision point — which agents run, with which briefs, re-plan after results, finished or not. The **runtime** is its engine (its *harness*, as Claude Code's code is the model's): it owns the state, runs what the Planner chose, and is the only code that changes the state — limits, checkpoints, pause / resume, events. Intelligence chooses, code validates and runs: the Planner returns a plan as zod-checked data (known agents, or the ad-hoc template), never prose; an invalid plan goes back once with the reason, then the runtime runs the flow's **default plan** (F1–F8), so a weaker Planner (the local 9B fallback) can't break a request.
  2. **The agents are the chain, and only agents** — Main, Planner, specialists, Architect, Critic, Scribe. Each is a node with no state of its own: it reads what it needs from the state and returns a result; the orchestrator merges it.
  3. **The queue is infrastructure, not an agent and not in the chain** — every model call an agent makes goes through the queue of its hardware (below), then the provider chain of its role.

- **State:** one zod-typed object per request: `{ status, plan, cards[], findings[], proposal?, pending? }`. Nodes return a partial update; reducers merge it (e.g. findings are appended).
- **States:** `scoping → planning → asking | awaiting_approval → running → writing → critiquing → done`, and `stopped | failed` from any state. An edge not in the graph is a test failure.
- **Checkpoints:** the state is saved after every node, per conversation: in memory now, in the room's Yjs document in M2, in Postgres in M3. Your next message resumes a paused request from its checkpoint.
- **Interrupts:** `asking` (the Planner's questions) and `awaiting_approval` (ad-hoc expert, later your Accept / Reject) end the HTTP request with a `paused` event; the resume comes with the next message.
- **Streaming:** every node emits `node_started`, `text`, `card` (a task's status), `finding`, `node_done` over the existing SSE stream; the chat shows a live checklist (AV2-11).
- **Observability:** one Phoenix span per node, with the state's version; a checkpoint list makes a run replayable.
- **The graph decides what runs, a queue decides when (hardware):** a node that calls a model is submitted to the **queue of its resource** — the local GPU runs **one call at a time**, a hosted provider a few at once within its rate limit (D13 picks the resource by role). A fan-out marks several cards ready; on one GPU they run one after another, on a hosted model in parallel, with no change to the graph. The queue is shared by every request (fair per room in M2/M3; user-facing steps — Main, Planner — before background specialist cards), and the live checklist comes from its state ("Cost running · 2 waiting").
- **Limits stay in code, in the queue:** ≤ 6 cards per request, 60 s per card, Stop cancels the running call and removes the request's waiting ones.
- **Re-plan:** after the cards run, the Planner may add cards once ("Data found a hot table → a Cache sub-brief"), within the 6-card budget.
- **Missing context (D21):** a specialist returns what it lacks as data — `needs: [{ what, from: board | memory | web | user }]`. The Planner fills it cheapest first: widen the card's boxes, fetch from memory, a Researcher card, or ask you (pause, resume); past the budget, it goes on with an assumption said out loud. One re-run per card. Your answer is saved as a requirement (never asked twice); `context_missing_total{agent, what}` shows which fetch recipe (D12) to improve, in a PR checked by evals.

### Consequences

- **Easier:** pausing for the user, runtime fan-out, a live checklist, replaying a failed run, and testing every transition with the fake LLM.
- **Harder:** we own the runtime (≈ 300–400 lines plus tests) and its bugs; checkpoint storage has to follow the room (M2, M3).
- **Revisit:** only if our runtime becomes the bottleneck (parallel branches on hosted models, long-running background graphs). Using the same names keeps that door open without walking through it.

## ADR-012 — Providers kept apart; the fallback chain is configuration

- **Date:** 2026-10-22
- **Status:** accepted (the owner)
- **Milestone:** M1c (agent V2)

### Context

AV2-02 … AV2-04 put Ollama's, Groq's and Gemini's quirks in one file (`openAiCompatible.ts`: Gemini's thought signatures, Groq's `tool_use_failed`, each one's 429 format), and the fallback is fixed at two steps (a hosted model, then the local one). Changing one provider risks the others; the order of the chain can't be read or changed.

### Options considered

1. Keep one OpenAI-compatible provider with dialect branches — less code, but every provider's quirks in one place.
2. **One folder per provider over a shared wire format; the chain as configuration; policies around providers.**

### Decision

Option 2. `wire/openaiChat/` is the OpenAI Chat Completions format only (request, SSE, tool-call assembly; no provider names). `providers/ollama/`, `groq/`, `gemini/`, `claude/` each hold only their own quirks, fixtures and tests, behind the same `LlmProvider`. A role's chain is an ordered list in configuration — `LLM_ROLE_PLANNER=groq:qwen/qwen3.8-27b+think > gemini:gemini-3.5-flash > ollama:designroom-qwen+think` — moving to the next link only before the first chunk (429, unavailable, silent past 15 s, budget used up), never after; the last link is always local. Spend caps, rate limits and the hardware queue (ADR-011) are policies wrapped around any provider, not code inside one.

### Consequences

- **Easier:** a provider change touches one folder; the chain is readable and per role; `llm_fallback_total{from, to, reason}` shows how often it moves.
- **Harder:** one more layer (policies) to wire in the composition root.
