# Agent architecture — V2 (draft, 2026-10-21)

Starts from [V1](architecture-v1.md). Boards: [v2/main-agent-flows.json](v2/main-agent-flows.json) (the chain) and [v2/full.json](v2/full.json) (everything: tools, sub-agents, clarify loop, Critic checks). Draw one with `node scripts/board-snapshot.mjs load <file>`.

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

## Proposed defaults (to confirm with the owner)

All drawn on the V2 board. Each is a starting value, changed by measurement.

| # | Part | Default | Why |
|---|---|---|---|
| D1 | **Flows** | The Planner picks one of F1–F8 for each request; drawn next to it, each pointing to who handles it | One path per kind of request, testable on its own |
| D2 | **Clarify loop** (Planner ⇄ Main) | At most **2 rounds**, at most **3 questions** per round, only for what changes the answer (scale, read/write, budget, cloud, region); then proceed with **stated assumptions** | Asking forever is as bad as guessing |
| D3 | **Trivial turns** ("thanks", "ok") | The Main agent answers alone, no Planner | No call wasted |
| D4 | **Task card** | `{ id, specialist, boxIds, question, budgetMs }` | The specialist gets only the boxes and the question it needs: a small context for a 9B model |
| D5 | **Queue limits** | ≤ **6 tasks** per request, **60 s** per task, **Stop** cancels the running and waiting tasks; the queue lives in memory, per request (a shared queue across rooms comes with Redis, M3) | One GPU; bounded wait |
| D6 | **Progress** | The queue sends progress to the Main agent, which shows it ("Security ✓ · Cost running · 2 left") | Long work must look alive |
| D7 | **Finding** (the contract) | `{ specialist, boxIds, severity: info/warn/critical, problem, fix?, confidence }`, zod-checked; stored on the blackboard with the board version | The Architect merges data, not prose |
| D8 | **Merge** | In code: dedupe by box + problem type, sort by severity, a conflict table (e.g. Cost "drop the replica" vs Chaos "keep it" → keep, with the trade-off for the user) | The hardest reasoning stays deterministic |
| D9 | **Critic** | Code checks first (applyOps, no duplicates, every box connected, no kind changed); a failing proposal goes back to the Architect **once**; an LLM Critic later, only if measured useful | Same 9B can't catch its own blind spots |
| D10 | **Sub-agents** | A specialist's sub-agents (Stack / Cloud; Data model / storage / consistency) are **sub-tasks in the same queue**, counted in the budget | One queue, one budget, one place to watch |
| D11 | **Flows first** | F2 (review), F6 (decision), F1 (question); then F4, F5, F3, F7, F8 | F2 is today's agent; F6 and F1 are small |

### The owner's answers so far (2026-10-21)

| # | Answer |
|---|---|
| D3 | ✅ Main agent alone for trivial turns |
| D5 | ✅ ≤ 6 tasks, 60 s each |
| D9 | No preference → default kept: code checks first, LLM check later if measured |
| D10 | ✅ Sub-tasks in the same queue |
| D2, D11 | To decide on the complete board: [v2/full.json](v2/full.json) (clarify loop and Critic checks drawn as boxes) |
| D1, D4, D6, D7, D8 | Not discussed yet |

## Build plan (each step measured before the next)

| Step | What | Done when |
|---|---|---|
| **S0 — M1-32** | Today's agent gets real tools: `check_design` (rules), `ask_user`, `finish`; nudges deleted | Demo boards ≥ 9/10 with no fake user message |
| **S1 — The orchestrator** | Our own small orchestrator (no LangGraph): typed state, the task queue (D4–D6), findings on the blackboard (D7), merge rules (D8), every step a span in Phoenix | Unit tests with a fake LLM; a review runs through the queue with one specialist |
| **S2 — Main + Planner** | The Main agent and the Planner with the clarify loop (D2, D3); flows F2, F6, F1 | Eval: ambiguous prompts get ≤ 2 rounds of questions; F2 at least as good as S0 |
| **S3 — First specialists** | Data and Security (rules first, then the agent explains), then Cost and Stack & Cloud (catalogue + prices in code) | Each with its eval boards; no regression on F2 |
| **S4 — More flows** | F4 (change), F5 (deep dive), F3 (draft, with the Planner and Draw mode) | Each flow has its e2e journey (fake LLM) and its eval |
| **S5 — Critic and Scribe** | Code Critic (D9), Scribe with the decision log and ADR export, F7, F8 | Accept/Reject feedback in Phoenix shows fewer rejections |
| **S6 — The rest** | Chaos and Traffic (with the A1 simulator), DevOps, Researcher (SearXNG), memory with RAG | Per specialist, measured |

Each step is its own ticket (or a few), written when we get there.
