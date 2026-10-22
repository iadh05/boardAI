# M1 — Solo board + AI reviewer

> Status: ready for review
> Depends on: nothing
> Architecture: [docs/architecture.md](../architecture.md)
> Tickets: [tickets/M1-solo-board.md](../../tickets/M1-solo-board.md)

## 1. Goal

One person draws a system-design diagram in the browser and talks about it with an AI (Qwen, running locally). The AI challenges the design and can **propose** new or changed nodes, which the user accepts or rejects. Errors go to Sentry; the AI path is visible in Grafana.

Three parts:
- **Setup:** monorepo, boundaries, app shells, UI kit.
- **M1a — Board:** canvas, typed + custom nodes, labels, arrows, delete. No saving.
- **M1b — AI reviewer:** ai-gateway and agent packages, chat module on server and web, ghost-node proposals, observability.

**Done when:** you draw `Client → Load Balancer → API → Database` (no cache), ask *"review my design"*, the AI points out the missing cache and proposes a Cache node connected to the API. You click **Accept** and it appears, wired in. The request shows up as a trace in Grafana. `pnpm test` and `pnpm lint` are green.

## 2. What you'll learn

- **Monorepo with pnpm** — apps vs packages, dependency rules enforced by lint.
- **Modular front end** — modules, pods, promotion, atomic design in a UI kit.
- **Zustand vs React Query** — client state vs server state.
- **Modular monolith + four layers** — keeping rules away from HTTP and I/O so modules can become services.
- **TDD** — pure functions first, then a server and an agent tested with a fake LLM.
- **LLM tool calling + agent loop** — and why everything the model sends is validated.
- **AI gateway pattern** — one door to LLM providers with timeouts, retries and metering.
- **Streaming** — Server-Sent Events from Hono, read with `fetch` streams.
- **Observability** — errors (Sentry) vs metrics/traces/logs (OpenTelemetry + Grafana).

## 3. Before you start

Answer in [learning-log.md](../learning-log.md):

1. Why is the AI's output a *proposal* and not a direct edit?
2. If the AI calls `connect_nodes(source: "n42")` and `n42` doesn't exist, where is that caught and what does the model hear back?
3. Why does the `agent` package only `import type` from `ai-gateway`?
4. Which state in M1 is client state and which is server state?
5. Which Qwen model fits your machine? (Ollama models that support tools.)

**Read:** React Flow (Quickstart, Custom Nodes), Zustand (README), TanStack Query (Mutations), Hono (Node.js, Testing, Streaming), Ollama (OpenAI compatibility, tools), OpenTelemetry JS (Getting started, Node), Sentry (React + Node setup), Feature-Sliced Design overview (for comparison with pods).

## 4. Scope

### In scope
- pnpm monorepo: `apps/web`, `apps/server`, `packages/domain`, `packages/agent`, `packages/ai-gateway`; lint-enforced boundaries.
- Web: modules `board` and `chat` with pods; `core/ui` atomic kit; Zustand stores; React Query.
- Canvas: pan, zoom, minimap; known kinds + Custom; edit label, move, delete; connect, delete edges.
- Server: modular monolith, composition root, `health` module, `chat` module in four layers, `POST /api/chat` (SSE).
- Agent with three tools (`add_node`, `update_node`, `connect_nodes`) and a loop limit; from 2026-10-21 (M1c) also `check_design`, `ask_user`, `finish`, then the multi-agent chain behind a flag — [architecture-v2.md](../agents/architecture-v2.md), [tickets/agent-v2.md](../../tickets/agent-v2.md).
- AI gateway: OpenAI-compatible provider (Ollama), fake provider, timeouts, retries, metering; from M1c also Groq and Gemini (same provider, their dialects), Claude through the official SDK (Haiku, Sonnet; spend cap), a model per role with the local fallback.
- Chat panel with streaming text; ghost nodes with Accept / Reject.
- Sentry (web + server); OpenTelemetry + local Grafana with one "AI reviewer" dashboard.
- Nginx edge proxy in Docker: routing, SSE passthrough, rate limit on `/api/chat`.
- CI on GitHub Actions: lint, typecheck, unit, Playwright e2e (fake LLM); protected `main`; PR review workflow.
- Coding rules in [docs/rules/](../rules/).
- ADRs 001–008.

### Out of scope
- Saving anything (M2), multiplayer (M2), AI deleting nodes, undo/redo (M2 with Yjs), node properties (A1), auth, deploy.

## 5. Design

See [architecture.md](../architecture.md): §3 repo and rules, §4 domain contract, §5 front end, §6 back end, §7 agent, §8 ai-gateway, §9 observability, §10 main flow.

## 6. Key decisions → ADRs

| ADR | Decision |
|---|---|
| ADR-001 | React Flow as the diagram library |
| ADR-002 | Own domain model (`packages/domain`); store data, not SVG |
| ADR-003 | Front end: modules + pods, promotion on 2nd use, Zustand + React Query |
| ADR-004 | Back end: modular monolith, four layers, packages for agent and ai-gateway |
| ADR-005 | Local Qwen behind an AI gateway (OpenAI-compatible) |
| ADR-006 | AI changes are proposals: validated server-side, accepted by the user |
| ADR-007 | Observability: Sentry for errors, OpenTelemetry + Grafana for metrics/traces/logs, Phoenix for agent traces (vs Langfuse) |
| ADR-008 | Nginx as edge proxy from M1 (vs Traefik/Caddy/Kong) |

## 7. Risks and unknowns

| Risk | How you'll find out early |
|---|---|
| Local model too slow / weak at tool calling | M1-15 spike before building the gateway and agent |
| Structure overhead slows M1 down | Only create a folder when the first file goes in it; review after M1a (M1-13) |
| Controlled React Flow + drag jank | M1-09: drag with ~100 nodes |
| Backspace in a label deletes the node | M1-11 acceptance criteria |
| SSE chunks split mid-event | M1-20 parser tests |
| Model invents node ids | Tool results return real ids; `applyOps` rejects unknown ids |

## 8. Testing strategy

See [architecture.md §11](../architecture.md#11-testing-strategy-tdd). Tests come first in every ticket with logic; the real model is used only by a manual script, never by `pnpm test`.

## 9. Demo script

1. `docker compose up -d` (Nginx + Grafana), start Ollama with your Qwen model, `pnpm dev`, open `http://localhost:8080`.
2. Add Client, Load Balancer, API, Database, and a **Custom** node labelled "Stripe".
3. Rename API to "Orders API". Connect Client→LB→API→Database and API→Stripe.
4. API→API and a duplicate edge are refused.
5. Delete Stripe: its edge disappears too.
6. Chat: *"review my design"*. Text streams in and mentions the missing cache.
7. A ghost Cache node appears near the API with a dashed edge. **Accept**: it becomes a normal node.
8. Get another proposal, delete the node it targets, click Accept: "proposal out of date", nothing half-applied.
9. Stop Ollama, send a message: clear error in the chat, the app keeps working.
10. Open Grafana: the chat request is a trace (HTTP → use case → agent rounds → LLM calls) and the dashboard shows LLM latency and tokens. Open Phoenix: the same request shows the prompt, each tool call with its arguments, and your Accept as feedback.
11. Trigger a test error in the web app: it appears in Sentry with a stack trace.
12. `pnpm test` (with Ollama stopped) and `pnpm lint` are green. Add an import from one pod into another pod's internals: lint fails.
13. Send 15 chat requests quickly: Nginx answers some with 429.
14. The last PR of M1 shows every CI check green (lint, format, typecheck, unit, security, commitlint, codeql, e2e).

## 10. Self-check

1. Walk through what happens between pressing Enter in the chat and seeing the ghost node — name each module/package it passes through.
2. Where is `applyOps` called, and why in both places?
3. What would you change to use a hosted model instead of Qwen? What would you change to make the ai-gateway a separate service?
4. Why does the agent work on a *draft copy* of the board?
5. Name two ways your code — not the prompt — stops the AI from damaging the board.
6. When do you look in Sentry and when in Grafana?
7. Something in `board/pods/canvas/lib` is now needed by the `toolbar` pod. Where does it move, and what if the server needs it too?
