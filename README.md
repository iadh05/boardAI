# DesignRoom

A real-time, multiplayer system-design whiteboard with an AI teammate that reviews your architecture — and a simulator that turns the diagram into a running system.

This is a **learning project**. Every milestone is meant to teach one big idea (CRDTs, WebSocket scaling, discrete-event simulation, tool-using agents, evals, cloud deploy) and end with a demo you can show.

## How this repo is organised

| Path | What it is |
|---|---|
| [MILESTONES.md](MILESTONES.md) | The roadmap. One checklist per milestone. The source of truth for *what*. |
| [docs/architecture.md](docs/architecture.md) | Front end + back end architecture, stack, contracts between them. |
| [docs/architecture-notes.md](docs/architecture-notes.md) | Brainstorm history and topics parked for later milestones. |
| [docs/rules/](docs/rules/) | Coding rules: general, frontend, backend. |
| [docs/workflow.md](docs/workflow.md) | Ticket → branch → PR → review → fix comments → merge. |
| [CLAUDE.md](CLAUDE.md) | Instructions for AI assistants working in this repo. |
| [docs/specs/](docs/specs/) | One spec per milestone: *why*, *how*, data model, risks, what you'll learn. Read before you start a milestone. |
| [tickets/](tickets/) | Work broken into small tickets (half a day to two days each). Status lives in the ticket. |
| [docs/decisions.md](docs/decisions.md) | Architecture Decision Records (ADRs). Every milestone adds at least one. |
| [docs/learning-log.md](docs/learning-log.md) | Your own notes: what you learned, what surprised you, what you'd do differently. |

## Running it locally

| What | Start | Open |
|---|---|---|
| Web + API (dev) | `pnpm dev`, plus `docker compose up -d` for Nginx | http://localhost:8080 |
| Production preview, real model | `pnpm --filter @designroom/web build && pnpm --filter @designroom/web exec vite preview --port 4180` with `API_URL=http://localhost:3000` | http://localhost:4180 |
| Grafana: the "DesignRoom overview" (home), "AI reviewer", traces, alerts | `docker compose up -d`; set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in `apps/server/.env` | http://localhost:3001 (admin / admin) |
| GlitchTip: error tracking (Sentry SDKs, nothing leaves the PC) | `docker compose --profile errors up -d`, then once `node scripts/glitchtip-setup.ts` | http://localhost:8000 (login in the root `.env`) |

### Watching it all: the overview

Grafana opens on **DesignRoom overview**, the one screen to check:

1. **At a glance** (top row): traffic, server error %, latency p95, bugs in the last hour, event-loop delay, memory, and the **firing alerts**. All green means nothing to do.
2. **Something red?** Go down to its row: *Traffic* and *Errors* per route and status, *Latency* per route, *AI reviewer* (model time, tokens, failures), *Server health* (event loop, memory, CPU).
3. **A bug?** The "Bugs" panels link to **GlitchTip** (stack traces). A slow request? The **Traces** link opens Tempo.
4. **Alerts** (Grafana → Alerting): bugs reported, 5xx over 5 %, model p95 over 30 s, event loop p99 over 200 ms. Locally they show in Grafana only; no email is sent.

To check the whole chain on purpose: set `ENABLE_DEBUG_ROUTES=true` in `apps/server/.env`, restart the server, open http://localhost:3000/api/debug/boom a few times. You get a 500, an issue in GlitchTip, the bug counters move, and "Bugs reported" fires within a minute or two.

The model runs in Ollama (start the Ollama app, not `ollama serve`); its settings are in [infra/ollama/Modelfile](infra/ollama/Modelfile). Docker on Windows needs the "Virtual Machine Platform" Windows feature.

## The loop for each milestone

1. **Read the spec** in `docs/specs/`. Answer its "Before you start" questions in your learning log.
2. **Pick the next ticket** in `tickets/`. Set it to `doing`. Only one `doing` at a time.
3. **Build it.** Tests first where the ticket says so.
4. **Check the acceptance criteria**, tick them off, set the ticket to `done`.
5. When every ticket is done, run the milestone's **demo script**. If it passes, write the ADR and the retro, then move on.

Do not start the next milestone until the current one's "Done when" passes (see [MILESTONES.md](MILESTONES.md)).

## Order (hiring spine)

M1 → M2 → M3 → A1 → M4 → M5 → M6 → Portfolio finish

We write the spec for a milestone just before starting it (one problem at a time). Advanced (A2–A7) and God tier (G1–G9) items get a spec when you reach them — use the template in [docs/specs/README.md](docs/specs/README.md); writing your own spec is part of the exercise.
