# DesignRoom — Milestones

Each milestone ends with something you can demo. Do not start the next one until the current one is done.

---

## M1 — Solo board + AI reviewer (local)
**Goal:** draw a system design diagram alone in the browser, and have a local AI (Qwen) challenge it and propose changes.

*Changed 2026-10-17: no localStorage (saving comes with Yjs in M2); pnpm instead of npm; AI reviewer pulled in from M4 in a simpler, single-user form. See [docs/specs/M1-solo-board.md](docs/specs/M1-solo-board.md).*

**Setup**
- [ ] Monorepo (pnpm workspaces): `apps/web`, `apps/server`, `packages/domain`, `packages/agent`, `packages/ai-gateway`
- [ ] Lint-enforced boundaries (packages, FE modules/pods, BE modules/layers)
- [ ] Web: modules + pods structure, `core/ui` atomic kit, Zustand + React Query
- [ ] CI on GitHub Actions (lint, typecheck, unit, Playwright e2e); protected `main`; PR review workflow — *all done except Playwright e2e (M1-03b)*
- [x] Code quality + security in CI: CodeQL, dependency audit + review, Dependabot, coverage gate; git hooks + commitlint
- [ ] Nginx edge proxy (routing, SSE, rate limit)
- [x] Coding rules for FE and BE (`docs/rules/`)

**M1a — Board**
- [ ] Vite + React + TypeScript + Tailwind app running
- [ ] React Flow canvas with pan and zoom
- [ ] Toolbar to add nodes by type (known kinds + Custom with a free label)
- [ ] Custom node component per type (icon + editable label)
- [ ] Connect nodes with arrows, delete nodes and edges
- [ ] Board operations written test-first (TDD)
- [ ] `docs/decisions.md`: why React Flow; own domain model; FE structure

**M1b — AI reviewer**
- [ ] Hono modular monolith; `chat` module in four layers with `POST /api/chat` streaming (SSE)
- [ ] Qwen running locally via Ollama, behind `packages/ai-gateway`
- [ ] Agent logic in `packages/agent`
- [ ] Agent tools: `add_node`, `update_node`, `connect_nodes` (no delete)
- [ ] Chat side panel with streaming replies
- [ ] Proposals as ghost nodes; Accept / Reject
- [ ] Sentry (web + server); OpenTelemetry + Grafana dashboard for the AI path; Phoenix for agent traces + Accept/Reject feedback
- [ ] `docs/decisions.md`: modular monolith; AI gateway; proposals instead of direct edits; observability

**Done when:** you draw "Client → Load Balancer → API → Database", ask the AI to review it, it points out the missing cache and proposes a Cache node connected to the API, and you accept it.

---

## M2 — Multiplayer (real-time sync)
**Goal:** two tabs edit the same board live, like Google Docs.

- [ ] Move board state into a Yjs document (nodes and edges as Y.Map)
- [ ] WebSocket sync server in `apps/server`
- [ ] Rooms: `/room/:id` URL, each room is its own document
- [ ] Live cursors with names and colors (Yjs awareness)
- [ ] Offline editing: changes made while disconnected sync on reconnect
- [ ] Connection status badge (connected / reconnecting / offline)
- [ ] Undo/redo per user (Y.UndoManager)
- [ ] Playwright test: edit in tab A, see it in tab B
- [ ] `docs/decisions.md`: what a CRDT is, why not "last write wins"

**Done when:** two tabs drag the same box at once and both end on the same result, with no errors.

---

## M3 — Persistence + scaling
**Goal:** rooms survive restarts, and the system handles many users.

- [ ] Save room snapshots + update log (Postgres or file storage, via Docker Compose)
- [ ] Load room from storage when the first user joins
- [ ] Run 2 server instances behind a simple proxy
- [ ] Redis pub/sub so users on different instances still sync
- [ ] Rate limiting per connection
- [ ] Load test: 100 simulated users in one room, record latency numbers
- [ ] Basic metrics: connected users, messages per second
- [ ] `docs/decisions.md`: scaling WebSockets, why Redis pub/sub

**Done when:** restart a server, the board is still there; users on different instances see each other.

---

## M4 — AI agent in the room
**Goal:** the agent joins as a teammate and helps review the design.

- [ ] Agent joins the room as a peer with its own cursor and name
- [ ] Tools: `read_board`, `propose_node`, `propose_edge`, `add_comment`, `ask_question`
- [ ] Proposals appear as ghost nodes; humans click Accept or Reject
- [ ] Agent edits are grouped and undoable in one step
- [ ] Side panel chat with streaming replies
- [ ] "Interview mode": agent asks follow-up questions about the diagram
- [ ] Safety: the agent can never delete or overwrite human nodes directly (enforced in server code, not only in the prompt)
- [ ] Cost guard: max agent calls per room per hour
- [ ] `docs/decisions.md`: agent design, why proposals instead of direct edits

**Done when:** you draw a design with no cache, and the agent notices, asks about it, and proposes a cache node you can accept.

---

## M5 — Evals
**Goal:** prove the agent is good, with numbers.

- [ ] 15 test diagrams with known flaws (single point of failure, no cache, no queue, no load balancer, etc.)
- [ ] Script that runs the agent on each and checks if it found the flaw
- [ ] Results table: catch rate, false alarms, average cost and latency
- [ ] Run evals after every prompt change
- [ ] `docs/evals.md` with results

**Done when:** you can say "the agent catches X of 15 known design flaws" and show the table.

---

## M6 — Deploy on Azure
**Goal:** a public demo link (needs Azure credit, e.g. Azure for Students).

- [ ] Front end on Azure Static Web Apps
- [ ] WebSocket sync via Azure Web PubSub or Container Apps
- [ ] Snapshots in Blob Storage
- [ ] Agent model via Azure OpenAI (or Claude API)
- [ ] Budget alert set first, everything in one resource group
- [ ] Application Insights for logs and errors
- [ ] **Observability system design** (production version of M1-25/M1-26's local god eye):
  - [ ] An OpenTelemetry Collector in front of the backends: one exporter in the app; sampling, batching and routing in the collector
  - [ ] Backend choice — Azure Monitor / Application Insights or Grafana Cloud — same OTel code, only the exporter changes
  - [ ] SLOs and error budgets (e.g. chat answer starts within 2 s for 99 % of requests; 99.5 % of requests without a 5xx)
  - [ ] Alerts that reach a person: a contact point (email / Teams), and a short runbook per alert
  - [ ] Production errors in GlitchTip or Sentry, with source maps uploaded (readable browser stack traces)
  - [ ] ADR: the design, what it costs per month, and what was left out
- [ ] Fine-tune the model as a solution architect (QLoRA on Qwen 3.5 9B fits the 16 GB GPU): data from M5's evals and the Accept/Reject feedback recorded in Phoenix (M1-26c); keep it only if the evals improve

**Done when:** a recruiter opens the link in two tabs and watches it sync.

---

# Advanced track (signature features)
Start only after M1–M3 are done. These are what make the project stand out.

## A1 — Simulation mode (the killer feature)
**Goal:** the diagram becomes a running system. Send traffic through it, watch bottlenecks, break things.

- [ ] Each node gets properties: capacity (requests/sec), latency (ms), replicas, failure rate
- [ ] Traffic slider: send N requests/sec from Client nodes
- [ ] Discrete-event simulation running in a Web Worker (UI stays at 60fps)
- [ ] Live visuals: animated requests on edges, overloaded nodes glow red, queue length badges
- [ ] Metrics panel: p50/p95/p99 latency, throughput, error rate
- [ ] Chaos button: kill a node and watch failover (or total failure)
- [ ] Cache hit ratio and queue buffering modeled correctly
- [ ] Simulation shared live with everyone in the room
- [ ] `docs/decisions.md`: how the simulation works, basic queueing ideas (Little's Law)

**Done when:** you push traffic until the database turns red, add a cache, and p95 latency drops on screen.

## A2 — Time travel, branches and diff
**Goal:** Git for diagrams.

- [ ] Version history from the Yjs update log, with a timeline slider to replay the board
- [ ] Named snapshots ("v1 before cache")
- [ ] Fork a board into a branch
- [ ] Visual diff between two versions (added = green, removed = red, changed = yellow)
- [ ] Merge a branch back
- [ ] `docs/decisions.md`: how history is stored without blowing up storage

**Done when:** you scrub the timeline, fork, change the design, and see a visual diff.

## A3 — Smarter agent
**Goal:** the agent proves its claims instead of guessing.

- [ ] Agent tool `run_simulation`: it tests its own suggestion before proposing it ("adding a cache cuts p95 from 800ms to 120ms")
- [ ] Multi-agent: Interviewer (asks questions), Critic (finds flaws), Chaos agent (attacks the design)
- [ ] Photo to diagram: upload a photo of a whiteboard sketch, agent turns it into nodes and edges
- [ ] Reference library: agent retrieves known architectures (RAG) to justify suggestions
- [ ] Evals updated to cover the new tools

**Done when:** the agent proposes a change, runs the simulation, and shows the before/after numbers.

## A4 — Diagram to infrastructure code
**Goal:** turn the drawing into deployable Azure infrastructure.

- [ ] Export the diagram to Bicep (or Terraform) for Azure
- [ ] Map node types to Azure services (Cache → Azure Cache for Redis, Queue → Service Bus, etc.)
- [ ] Agent explains each generated resource and its cost tier
- [ ] Validate the output (bicep build / terraform validate)

**Done when:** you draw a design and get valid infrastructure code for it.

## A5 — Security and performance hardening
- [ ] End-to-end encrypted rooms (key lives in the URL fragment, server never sees content)
- [ ] Roles: owner / editor / viewer, signed share links, auth on the WebSocket
- [ ] 5,000-node stress test: viewport virtualization, profiling, stays smooth
- [ ] Keyboard-only editing and screen-reader descriptions of the diagram (accessibility)
- [ ] OpenTelemetry tracing: front end → server → agent in one trace

## A6 — Voice calls in the room
**Goal:** people in the same room talk to each other live while drawing, like a WhatsApp group call inside the board. Start after M2 (needs rooms and presence).

**Step 1: 1-to-1 call (peer-to-peer)**
- [ ] Mic permission flow and device picker (choose microphone)
- [ ] WebRTC audio call between 2 users, signaling over the existing WebSocket server
- [ ] STUN for connecting through home routers; TURN server (coturn in Docker) as fallback
- [ ] Mute/unmute, speaking indicator on the user's cursor, call quality badge
- [ ] Reconnect when the network drops

**Step 2: group calls**
- [ ] Mesh (everyone connects to everyone) for up to 4 people
- [ ] Measure where mesh breaks (CPU, bandwidth) and write it down
- [ ] Switch to an SFU (self-hosted LiveKit or mediasoup) for bigger rooms
- [ ] `docs/decisions.md`: mesh vs SFU vs MCU, with your measurements

**Step 3: voice + AI**
- [ ] Live transcription of the call (speech-to-text)
- [ ] Agent listens to the discussion and proposes diagram changes ("you said we need a queue, add one?")
- [ ] Meeting summary at the end: decisions made and open questions
- [ ] Privacy: clear "transcription on" indicator, everyone must opt in

**Done when:** 3 people talk while drawing, and the agent proposes a node based on what was said.

## A7 — Architecture docs in, living docs out
**Goal:** bring existing architecture docs (Confluence, PDF, Word, Markdown) into the room. Start after M4 (needs the agent).

- [ ] Upload PDF, Word (.docx) or Markdown; parse to clean text
- [ ] Import a Confluence page by link (Confluence REST API + OAuth)
- [ ] Big files processed as background jobs (queue + progress bar)
- [ ] Agent extracts components and connections, drafts the diagram as ghost nodes
- [ ] Chunk + embed the doc (vector search) so the agent answers with citations ("section 3.2 says...")
- [ ] Link each node to the doc section that describes it (click node → see the source)
- [ ] Drift check: highlight where the doc and the diagram disagree
- [ ] Export: decisions as ADRs (Markdown) or back to Confluence
- [ ] Security: uploaded docs are data, never instructions (prompt-injection test in evals)
- [ ] `docs/decisions.md`: chunking strategy, why RAG, how citations work

**Done when:** you upload a real architecture doc, get a draft diagram, and the agent answers a question citing the right section.

---

# God tier (deep engineering, pick by target job)
Only after the hiring spine is shipped (see "Recommended path" at the bottom).

## G1 — Your own CRDT
- [ ] Implement a minimal CRDT for the graph (LWW map for node properties, OR-set for nodes and edges, Lamport clocks)
- [ ] Binary sync protocol with state vectors (send only what the other side is missing)
- [ ] Property-based tests: random concurrent edits always converge
- [ ] Benchmark against Yjs (memory, update size, merge speed) and write up the results

## G2 — Simulation engine in Rust + WebAssembly
- [ ] Port the A1 engine to Rust, compile to WASM, run in a Web Worker
- [ ] Target: 1 million simulated requests/sec in the browser
- [ ] Benchmark JS vs WASM, with charts in the README

## G3 — GPU renderer
- [ ] Replace DOM rendering with WebGL/WebGPU for 50,000 nodes at 60fps
- [ ] Spatial index (quadtree) for hit-testing and culling
- [ ] Level of detail: simplified nodes when zoomed out

## G4 — Peer-to-peer local-first mode
- [ ] WebRTC data channels between peers, server only for signaling and relay fallback
- [ ] IndexedDB persistence + service worker: fully works offline as a PWA

## G5 — Availability and cost math
- [ ] Compute availability ("how many nines") from replicas, regions and service SLAs
- [ ] Fault-tree view: which single failure takes the whole system down
- [ ] Monthly cost estimate per design using Azure pricing data

## G6 — Design optimizer agent
- [ ] Input: SLO (e.g. p95 < 200ms, 99.95% uptime) + monthly budget
- [ ] Agent generates design variants, runs each in the simulator, keeps the best
- [ ] Shows a cost vs latency chart (Pareto front) and explains the trade-off
- [ ] Evals: does it find the known-best design on benchmark problems?

## G7 — Real systems in, real systems out
- [ ] Import: read docker-compose, Kubernetes manifests or Terraform and auto-draw the diagram
- [ ] Import: read a live Azure subscription (Resource Graph) and draw what is deployed
- [ ] Drift detection: highlight where the diagram and the real deployment differ
- [ ] Live mode: connect nodes to real OpenTelemetry metrics, compare simulated vs actual

## G8 — Full mock interview
- [ ] Voice interviewer agent (realtime speech), timed 45-minute session
- [ ] Session replay: board timeline synced with the conversation
- [ ] Scoring report against a rubric (requirements, scaling, trade-offs, communication)
- [ ] LLM-as-judge evals checked against your own human labels

## G9 — Platform
- [ ] Plugin SDK: third-party node types and tools in sandboxed iframes
- [ ] Multi-region sync servers on Azure, rooms routed by consistent hashing, regional failover
- [ ] Public read-only embed widget for blogs and READMEs

---

# Recommended path
**Hiring spine (ship this first, ~this is what gets interviews):**
M1 → M2 → M3 → A1 → M4 → M5 → M6 → Portfolio finish
(A6 voice calls fits right after M2 or after M4, if you want it in the spine)

**Then pick depth by the job you target:**
- Senior front-end / product companies: G3, G1, A2, A5 (accessibility + performance)
- AI engineering roles: A3, G6, G8
- Platform / cloud roles: A4, G5, G7, G9
- Deep systems interest: G1, G2, G4

---

## Portfolio finish
- [ ] README with demo GIF, architecture diagram (drawn in DesignRoom), and trade-offs
- [ ] 2-minute demo video
- [ ] Load test and eval numbers in the README

---

## Later (ideas parked, not now)
- **M7 — Detailed design (to discuss):** API endpoints, layers and contracts per component. Until then the AI reviewer stays at system level (components, data, connections) — decided 2026-10-19.
- Agent web search for real-world use cases (fits A3); voice in the room (A6 step 3) or several agent personas (A3 multi-agent) — decided 2026-10-19, after M1.
- **Design ↔ code round trip (discuss in M7):**
  - *Diagram → running app:* each box designed in detail (FE, API, DB, infra) and built by AI agents, wired together (FE calls API, API reads DB). Runs **locally on the user's machine** (a local helper/agent, not the web app — doesn't scale there). Open: templates vs agents per component, does a code change update the board.
  - *Running app → diagram:* import an existing project (builds on G7), see its architecture drawn, then simulate it (A1): traffic, overloaded servers, chaos — what goes down.
- Situation card: the scenario (users, peaks, budget) pinned on the board, read by the AI on every request; shared in M2 — the three-architects journey.
-
