# Specs

One spec per milestone. A spec answers **why** and **how**; the milestone checklist answers **what**; tickets answer **what next**.

| Spec | Milestone | Status |
|---|---|---|
| [M1 — Solo board + AI reviewer](M1-solo-board.md) | Diagram editor + local Qwen reviewer | ready for review |
| M2 — Multiplayer | Yjs + WebSocket sync | not written — write before starting M2 |
| M3 — Persistence + scaling | Postgres, Redis, 2 instances | not written |
| A1 — Simulation mode | Discrete-event simulator | not written |
| M4 — AI agent in the room | Agent as a room peer | not written |
| M5 — Evals | Measuring the agent | not written |
| M6 — Deploy on Azure | Public demo | not written |

Specs are allowed to change. When reality disagrees with the spec, update the spec (and say why in the ADR) rather than silently drifting.

---

## Spec template

Copy this for A2–A7 / G1–G9 when you get there.

```markdown
# <ID> — <Name>

> Status: draft | ready | in progress | done
> Depends on: <milestones>

## 1. Goal
One paragraph. What can a user do at the end that they couldn't before?

## 2. What you'll learn
Concepts this milestone exists to teach. 3–6 bullets.

## 3. Before you start
Questions to answer (in your learning log) before writing code. Reading list.

## 4. Scope
### In scope
### Out of scope (non-goals)

## 5. Design
Architecture sketch, data model, key flows, interfaces between parts.

## 6. Key decisions
Decision → options considered → choice → why. Each becomes an ADR.

## 7. Risks and unknowns
What could go wrong, and how you'll find out early.

## 8. Testing strategy
Unit / integration / e2e — what each level covers.

## 9. Demo script
Exact steps that prove "Done when".

## 10. Self-check
Questions you should be able to answer without notes once you're done.
```
