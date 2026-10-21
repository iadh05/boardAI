# Agent architecture — V2 (draft, 2026-10-21)

Starts from [V1](architecture-v1.md). Board: [v2/main-agent-flows.json](v2/main-agent-flows.json) (draw it with `node scripts/board-snapshot.mjs load docs/agents/v2/main-agent-flows.json`).

## The owner's decisions (2026-10-21)

1. **Real agents**, not only tools: the specialists stay LLM agents, as in V1.
2. **A queue, not parallel:** the Architect's tasks run **one at a time**. On one GPU, Ollama answers one call at a time anyway; the queue makes that explicit and lets the user watch progress.
3. **A Main agent (the master)** is the only one that talks with you.
4. **The Planner owns the prompt:** it clarifies ambiguous questions (asking back through the Main agent), writes the needs into the requirements card, picks the flow and plans the tasks.
5. **The Architect spawns the agents** for the plan (as in V1), merges their findings and owns the design.

## The chain

```
You ⇄ Main agent ──▶ Planner ──▶ Architect ──▶ Task queue ──▶ specialist agents (one at a time)
          ▲             │            ▲                              │
          │   question back          └──── typed findings ◀── Blackboard
          └──── checked proposal ◀── Critic ◀── Architect
```

| Agent | Owns | Hands over |
|---|---|---|
| **Main agent** (master) | The conversation: your language, the thread across turns, progress ("Security ✓ · Cost running · 2 left"), the final answer | Your request → Planner; Accept / Reject → Scribe |
| **Planner** | The prompt: what you really ask, what's ambiguous (it asks back, and challenges assumptions — the Interviewer's job), your needs (requirements card), the flow, the plan | A plan: flow + the tasks → Architect |
| **Architect** | The design: spawns one task per specialist the plan needs, merges their findings, resolves their conflicts, writes the proposal | Tasks → queue; proposal → Critic |
| **Task queue** | Order and limits: one task at a time, a per-task timeout, a budget per request, cancel on Stop | Each task → its specialist |
| **Specialists** | One concern each (Data, Security, Traffic, Chaos, Cost, DevOps, Researcher, Stack & Cloud) | A **typed finding** → blackboard |
| **Critic** | Checks the proposal before you see it (code checks first) | Checked proposal → Main |
| **Scribe** | Decisions and why | Decision log, ADRs |

## The flows (picked by the Planner)

| # | You say | Flow | Who works |
|---|---|---|---|
| F1 | "What is a CDN?" / "Why Kafka here?" | **Question:** answer, no board change | Main → Planner → (Researcher) → Main |
| F2 | "Review my design" | **Review** | Main → Planner → Architect → queue (all relevant specialists) → Critic → Main |
| F3 | "Design me an Uber Eats" | **Draft:** needs first, then a whole draft | Main ⇄ Planner (asks) → Architect → queue → Critic → Main |
| F4 | "Add a cache in front of Postgres" | **Change request:** do what's asked, checked | Main → Planner → Architect → queue (Data, Cost if relevant) → Main |
| F5 | "Is it secure?" / "How much will it cost?" | **Deep dive:** one specialist | Main → Planner → Architect → queue (one task) → Main |
| F6 | Accept / Reject | **Decision** | Main → Scribe → memory |
| F7 | "No, keep RabbitMQ" | **Disagreement:** weigh the reason, change view or explain | Main → Planner → Architect (with memory) → Main |
| F8 | "What did we decide about the queue?" | **Recall** | Main → Scribe / memory |

## V1's downsides, and how V2 answers them

| Downside (V1) | V2 |
|---|---|
| "Parallel" on one GPU is a lie | **Queue**, one task at a time, progress shown |
| Too many calls per question | The Planner plans only the tasks the flow needs; a **budget per request** (max tasks) |
| No contracts between agents | Every specialist returns a **typed finding** `{ specialist, boxIds, severity, problem, fix }`, zod-checked |
| Specialists overlap | Each finding type owned by **one** specialist; the Architect deduplicates by box + type |
| Errors multiply along the chain | At most **4 LLM hops** per answer (Main, Planner, Architect + its tasks, Critic), each checked in code |
| Hardest job (merge) on the 9B | Merge and conflict rules in **code**; the Architect explains them |
| Memory goes stale | Findings stamped with the board version; recomputed after an edit |
| Evals explode | One specialist at a time, each with its eval boards (M5) |
| Built before measured | **M1-32 first** (one agent + tools); then the Planner and Main; then specialists one by one, measured |

## Still open

1. The queue: in memory per request now; a shared queue across rooms (Redis, M3) when several people use the agent at once?
2. Which flows ship first? Suggestion: F2, F6, F1, then F4, F5, F3, F7, F8.
3. Does the Planner always run, or does the Main agent answer trivial turns ("thanks") alone?
