# Progress

> Living status of the project — updated in every ticket PR. Read this first when resuming (human or AI).
> Details: [MILESTONES.md](MILESTONES.md) · [tickets/M1-solo-board.md](tickets/M1-solo-board.md) · [docs/architecture.md](docs/architecture.md)

**Last updated:** 2026-10-18 · **Milestone:** M1 — Solo board + AI reviewer · **Now:** M1-09 canvas (React Flow)

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

## In progress

- **M1-09** — canvas pod: React Flow + `toFlow` mapper.

## Next

M1-10…M1-13 board UI (M1a) → M1-14… AI reviewer (M1b).

## Planned reviews

- **End of M1:** UI kit → design-system package (`packages/ui`)? Some modules → packages? (in M1-27)

## Waiting on you

- **M1-01c:** direct pushes to `main` are still allowed for admins. Turn on `enforce_admins` so every change goes through a PR? (GitHub setting — your call.)
- **Optional:** Dependabot security updates (Settings → Code security).
- **Phone notifications:** enable Remote Control for the session in the Claude app.

## How work flows

ticket → branch → tests first → **full `/code-review`** (findings listed in the PR) → PR (template) → CI (7 required checks) → GitHub auto-merge when green → branch auto-deleted. See [docs/workflow.md](docs/workflow.md).

## Notes for whoever resumes

- Windows: pnpm **10** (11/12 need symlink rights); git hooks call `node_modules/.bin/*`, not `pnpm exec` (hangs on long arg lists).
- `gh` lives at `C:\Program Files\GitHub CLI\gh.exe`, logged in as iadh05.
- Known accepted advisory: braces GHSA-vfj7-8cjw-p6xm (no fix released; lint-time only).
