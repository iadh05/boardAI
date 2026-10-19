# Progress

> Living status of the project — updated in every ticket PR. Read this first when resuming (human or AI).
> Details: [MILESTONES.md](MILESTONES.md) · [tickets/M1-solo-board.md](tickets/M1-solo-board.md) · [docs/architecture.md](docs/architecture.md)

**Last updated:** 2026-10-19 · **Milestone:** M1 — Solo board + AI reviewer · **Now:** M1-26a traces → M1-26b metrics + Grafana and M1-26c Phoenix next (both need Docker) (M1-13 structure verdict pending)

## Done

| Ticket | What | PR |
|---|---|---|
| M1-01 | pnpm monorepo, strict TS, Vitest, ESLint, Prettier | #1 |
| M1-01b | CI on GitHub Actions | #1 |
| M1-01d | CodeQL, dependency audit + review, Dependabot, coverage gate | #2 |
| M1-01e | Lefthook hooks, commitlint, split CI checks | #3 |
| M1-02 | Architecture boundary rules (packages, web pods/modules, server layers, banned names) | #6 |
| M1-03 | Web shell: Vite + React + Tailwind + React Query + AppShell | #7 |
| M1-05 | Board model as zod schemas (`packages/domain`) | #8 |
| M1-03b | Playwright e2e (production build) + CI job with browser cache | #9 |
| — | Post-merge review of #6/#7/#9: 7 fixes, e2e made a required check | #10 |
| M1-04 | `core/ui` kit (atoms, molecules, Panel) + design tokens | #11 |
| M1-06 | Pure board operations + `Result` type, property-based test | #12 |
| M1-07 | AI operations, all-or-nothing `applyOps`, chat API contract | #13 |
| M1-08 | Board store (Zustand factory), `showProposal`, `createId` | #14 |
| M1-09 | React Flow canvas from the store, ghost-node preview, 60 fps with 100 nodes | #15 |
| M1-10 | Toolbar: one button per kind, adds mid-view and nudges repeats; fit-view zoom capped at 1× | #16 |
| M1-11 | Node icon + colour per kind, rename in place (double-click / Enter), Custom opens in edit mode; first board e2e journey | #17 |
| M1-12 | Connect by dragging (domain `canConnect` for live feedback), Delete/Backspace through the store; demo chain e2e | #18 |
| M1-14 | Server skeleton: composition root, zod config, JSON logger, error mapping, request ids, health | #29 |
| M1-14b | Nginx edge proxy on :8080 (routing, request ids, WebSocket, 1 MB limit, 429 on chat) + `edge` CI smoke test | #30 |
| M1-15 | Qwen spike: `qwen3.5:9b`, thinking off via `reasoning_effort: "none"`, 64 tok/s, 3/3 tool calls; stream fixtures | #31 |
| M1-16 | `packages/ai-gateway`: OpenAI-compatible + fake providers, SSE reader, idle timeout, retry before first chunk, cancellation, usage | #32 |
| M1-17 | `packages/agent`: tools (add/update/connect, no delete) on a draft, short aliases instead of UUIDs, `boardToText` | #33 |
| M1-18 | Agent loop: rounds of model → tools → results, one proposal, max rounds, per-round metering; board as delimited data in the last message | #34 |
| M1-19 | Server chat module: `POST /api/chat` streams the review (SSE); chat policy (context budget), user-facing model errors, per-request logger, 1 MB limit | #35 |
| M1-19b | Fake model with scenario files (stateless, parallel-safe), e2e server on :3100 behind `vite preview`, AI review e2e at API level (UI journeys after M1-23) | #36 |
| M1-20 | Web `core/api` SSE reader: bytes → JSON events, split chunks reassembled, bad event = error item | #37 |
| M1-21 | Web chat module: `chatStore`, `sendMessage` (stream → store, proposal → board, every failure explained), `useSendMessage` with cancel | #38 |
| M1-22 | Chat panel: conversation log, "Thinking…", streaming answer, inline errors, Enter to send, Stop, auto-scroll | #39 |
| M1-UX2 | Nothing hides boxes: no fit on the first box, spawn avoids the toolbar, hints in the toolbar panel | #40 |
| M1-23 | Proposal card (Accept / Reject / out of date), ghosts placed once and accepted where shown, demo e2e journeys, Stop e2e | #41 |
| M1-24 | Prompt v2 from sample boards (1/4 → 3/4, injection never obeyed), `scripts/review-samples.ts`, summary never shows an id | #42 |
| M1-24b | Scope guard: system design only — a classifier call before the review, fixed reply when off topic (30/30), stricter prompt | #43 |
| M1-25 | Sentry web + server, off without a DSN; page and chat error boundaries; no board/chat/prompt data sent | #44 |
| M1-26a | Traces: one chat request = one trace (HTTP → review → agent → scope check / rounds → LLM calls, tools), trace id in logs; M1-26 split into a/b/c | #45 |

## In progress

- **M1-13** — waiting on your structure-review verdict (docs/checkpoints/M1a.md).
- **Diagram package (M1-D1…D5)** — the canvas moves into `@designroom/diagram` (React Flow + libavoid), [ADR-004](docs/decisions.md). D-1 done (#20), D-2 `<Diagram>` (#21), D-3 libavoid routing (#22), D-4 the app uses it (#23). UX polish after a manual pass (#24). Arrows with labels and sync/async (#25, #27), zones (#26, #28).

## Next

M1-13 closes M1a → M1-14… AI reviewer (M1b).

## Planned reviews

- **End of M1:** UI kit → design-system package (`packages/ui`)? Some modules → packages? A shared SSE reader (ai-gateway and web each have one)? (in M1-27)

## Waiting on you

- **Docker:** enable Windows' *Virtual Machine Platform* (`dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart` as admin, then restart). Until then Nginx is only checked in CI (`edge` job).
- **Branch protection:** add the new `edge` check to the required checks (GitHub setting — your call).

- **M1-01c:** direct pushes to `main` are still allowed for admins. Turn on `enforce_admins` so every change goes through a PR? (GitHub setting — your call.)
- **Optional:** Dependabot security updates (Settings → Code security).
- **Phone notifications:** enable Remote Control for the session in the Claude app.

## How work flows

ticket → branch → tests first → **full `/code-review`** (findings listed in the PR) → PR (template) → CI (7 required checks) → GitHub auto-merge when green → branch auto-deleted. See [docs/workflow.md](docs/workflow.md).

## Notes for whoever resumes

- Windows: pnpm **10** (11/12 need symlink rights); git hooks call `node_modules/.bin/*`, not `pnpm exec` (hangs on long arg lists).
- `gh` lives at `C:\Program Files\GitHub CLI\gh.exe`, logged in as iadh05.
- Known accepted advisory: braces GHSA-vfj7-8cjw-p6xm (no fix released; lint-time only).
