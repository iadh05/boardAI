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
