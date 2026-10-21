# Agent architecture — V2 (draft, 2026-10-21)

Starts from [V1](architecture-v1.md). Boards: [v2/final.json](v2/final.json) (**the final design**: levels, Groq, queue, Critic, knowledge, caches), [v2/main-agent-flows.json](v2/main-agent-flows.json) (the chain) and [v2/full.json](v2/full.json) (everything: tools, sub-agents, clarify loop, Critic checks). Draw one with `node scripts/board-snapshot.mjs load <file>`.

## The owner's decisions (2026-10-21)

1. **Real agents**, not only tools: the specialists stay LLM agents, as in V1.
2. **A queue, not parallel:** the Architect's tasks run **one at a time**. On one GPU, Ollama answers one call at a time anyway; the queue makes that explicit and lets the user watch progress.
3. **A Main agent (the master)** is the only one that talks with you.
4. **The Planner owns the prompt:** it clarifies ambiguous questions (asking back through the Main agent), writes the needs into the requirements card, picks the flow and plans the tasks.
5. **The Architect spawns the agents** for the plan (as in V1), merges their findings and owns the design.

Added the same day, after measuring (§ Models):

6. **The Planner is our prompt engineer:** it builds each agent's brief and decides what context it gets, so it gets the strongest model and thinking (D13).
7. **The Critic is a smart agent**, on a different model from the specialists, after the code checks (D14).
8. **Knowledge is visible and correctable in the UI** (D15), in three scopes (D12).
9. **LLM cache and LLM memory are separate things** (D16 vs D12).

## Three levels

| Level | Agents | Model | Thinking | Why |
|---|---|---|---|---|
| 1 | **Main** | local 9B | off | Answers fast; relays, doesn't decide |
| 2 | **Planner**, **Critic** | hosted (Groq), local 9B as fallback | **on** | They decide what everyone else sees and what you get; a mistake here spreads to everything |
| 3 | **Specialists**; the Architect's explanation | local 9B | off | Small focused briefs; many calls, so speed matters |

The Architect's *plan* and *merge* are code (the Planner's plan lists the tasks; D8 merges), so level 2 costs at most two thinking calls per request.

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
| **Critic** | Checks the proposal before you see it: code checks, then an LLM Critic on another model (D14) | Checked proposal → Main |
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
| D9 | **Critic** | Code checks first (applyOps, no duplicates, every box connected, no kind changed); a failing proposal goes back to the Architect **once**. *Extended by D14: an LLM Critic on another model after the code checks* | Same 9B can't catch its own blind spots |
| D10 | **Sub-agents** | A specialist's sub-agents (Stack / Cloud; Data model / storage / consistency) are **sub-tasks in the same queue**, counted in the budget | One queue, one budget, one place to watch |
| D11 | **Flows first** | F2 (review), F6 (decision), F1 (question); then F4, F5, F3, F7, F8 | F2 is today's agent; F6 and F1 are small |
| D12 | **LLM memory** (knowledge) | Three scopes, per-specialist fetch recipes, the Planner writes the queries — see § Knowledge | Naive RAG returns similar text, not the right context |
| D13 | **Thinking and models** | Thinking only on level 2. The Planner runs on Groq (Qwen3.8 27B, thinking on), with the local 9B + thinking as fallback (offline, limit reached, Groq switched off) | Measured: thinking helps quality; the 14B is no better and costs a 14 s swap — see § Models |
| D14 | **Smart Critic** | After the code checks (D9), an LLM Critic on Groq, from **another model family** (gpt-oss-120b, to measure against Qwen3.8 27B), thinking on. Reads requirements + findings + proposal; returns `{ verdict: pass \| revise, issues: [{ boxIds, problem, why }] }`; `revise` goes back to the Architect once. Kept only if Accept/Reject feedback shows fewer rejections | Another model doesn't share the specialists' blind spots; code can't see a broken requirement |
| D15 | **Knowledge in the UI** | A *Room knowledge* panel (Requirements · Decisions · Sources · Global) and citations in every answer. Agents never edit knowledge: they propose ("Save as decision…?") and you Accept, like ghost boxes | A wrong memory you can't see steers every answer |
| D16 | **LLM cache** | Four caches keyed by the context each agent actually used — see § Cache | Speed and quota without stale answers |

### The owner's answers so far (2026-10-21)

| # | Answer |
|---|---|
| D3 | ✅ Main agent alone for trivial turns |
| D5 | ✅ ≤ 6 tasks, 60 s each |
| D9 | No preference → default kept: code checks first, LLM check later if measured |
| D10 | ✅ Sub-tasks in the same queue |
| D2, D11 | To decide on the complete board: [v2/full.json](v2/full.json) (clarify loop and Critic checks drawn as boxes) |
| D12–D16 | ✅ Agreed in the brainstorm: Planner = prompt engineer with thinking, smart Critic, knowledge visible in the UI, layered memory (not naive RAG), cache by context |
| D1, D4, D6, D7, D8 | Not discussed yet |

## Models — measured, not assumed (2026-10-21)

Same agent, prompt and boards (`scripts/review-samples.ts`, 5 boards × 5 runs; `--think` turns thinking on), RTX 5060 Ti 16 GB:

| Setup | Runs passed | Proposed a change | Ids leaked | Mistakes (reversed arrow, kind changed) | Time p50 |
|---|---|---|---|---|---|
| **Qwen3.5 9B, thinking off (today)** | 22/25 | 19/25 | 5 | 1 | **~9 s** |
| Qwen3.5 9B, thinking on | 21/25 (1 timeout) | 22/25 | **0** | 0 | ~32 s |
| Qwen3 14B, thinking off | 10/25 | **0/25** — never calls a tool | 0 | 0 | 2 s |
| Qwen3 14B, thinking on | **24/25** | 22/25 | **0** | 2 | ~65 s (p95 117 s) |

- Thinking helps quality (no leaked ids, more real fixes) and costs about **+23 s per call** on the 9B (≈ 1,400 thinking tokens).
- 9B and 14B don't fit in 16 GB together; a **swap costs 13–15 s** each way (3 runs each). A 14B Planner between 9B agents would add ~27 s to every request.
- 5 runs per board: 24/25 vs 22/25 is within noise. The 14B is not clearly better, only slower.

**Hosted: Groq** (OpenAI-compatible, so our gateway only needs `LLM_API_KEY`; thinking set per call with `reasoning_effort`):

| | Qwen3.8 27B | gpt-oss-120b |
|---|---|---|
| Speed | ~450 tok/s | ~500 tok/s |
| Price per M tokens in / out | $0.80 / $4.00 | $0.15 / $0.60 |
| Thinking | off, low, medium, high | low, medium, high |
| Vision | ✅ (A3 photo → diagram) | ❌ |
| Role here | **Planner** (same family as the 9B: briefs in its language) | **Critic** (another family); later the Researcher (Groq's built-in browser search) |

**Free tier** (limits counted per model; the table Groq publishes is labelled *Developer plan*, so check *Settings → Limits*): ~30 requests/min, ~8k tokens/min, ~1k requests and ~200k tokens/day. Planner and Critic use ~4k tokens each per request → ~50 requests a day: enough to build and demo; one full eval run uses about a day. On HTTP 429 they fall back to the local 9B with thinking. Paid (M6, real users): ~$0.02 per request.

**Privacy:** with Groq, the request and a board summary leave the PC (today nothing does). An `.env` switch turns Groq off; an ADR records the choice.

## Response-time budget (estimates until measured)

Simulator with the same model: <https://claude.ai/artifact/J5hfBMCypwXJqxRVAXAbV8>.

| Request | Target | Estimate, local 9B only | With Groq on level 2 + caches |
|---|---|---|---|
| F1 question, F8 recall | < 5 s | ~3–4 s | same |
| F4 change | < 20 s | ~25 s | ~15 s |
| F2 full review | < 45 s, first progress < 10 s | ~60 s (≈ 80 s with a local thinking Planner) | ~50 s; a re-review after a small edit ~15 s |
| Any request | progress always visible (D6) | | |

The specialists on the local GPU are the remaining cost; the master skipping agents the request doesn't need is worth ~6 s per agent.

## Knowledge — LLM memory (D12)

Memory changes the answer; it's the project's history, never thrown away.

| Scope | Contains | Lives | Written by |
|---|---|---|---|
| **Request** | Briefs, findings, the blackboard | One request | The agents |
| **Room** | Requirements card, decisions + why, rejected proposals, chat history | With the board (saved from M3) | **Only the Scribe**, after Accept / Reject |
| **Global** | Reference architectures, cloud catalogue and prices, curated docs | Always, shared, read-only | Us, in reviewed PRs — never agents |
| Web cache | Pages the Researcher read, `trusted: no` | A few days | The Researcher |

- Every search is scoped to **this room + global**; never another room (privacy, M2/M3).
- One store, every piece labelled: `{ text, type, topics, boxIds, boardVersion, source, date, trusted, replacedBy? }`.
- **Structured first:** requirements always included; decisions fetched **by box id** and the boxes next to them on the board; replaced decisions filtered out. No similarity search for these.
- **Search only for text** (old chat, docs, web): hybrid (keywords for exact names like "Kafka" + embeddings), chunks stored with a line of context, a re-ranker keeps the best 5.
- **The Planner writes each specialist's query**; a **recipe per specialist** in code (Data: decisions on its data boxes + `data` docs; Security: externally reachable boxes + trusted docs; Cost: budget + the catalogue's prices).
- **Context builder in code:** token budget per agent (~1,500 tokens of fetched context), dedup, newest decision first, every piece labelled with its source and passed as **data, not instructions**.
- Embeddings local (a < 1 GB embedding model next to the 9B); store local first, pgvector with M3's Postgres.
- Later (A5): end-to-end encrypted rooms mean the server can't embed them — decide then.

## Cache — LLM cache (D16)

A cache never changes the answer, only its speed; delete it and everything still works.

| Cache | Key | Gain |
|---|---|---|
| **Prompt prefix** (Ollama KV, Groq prompt caching) | Exact text; prompts ordered stable → changing: shared rules, tools, requirements + board, *then* the role, fetched context, the task | Each queued specialist re-reads ~800 tokens instead of ~3,000 (~7 s per review); cached Groq tokens don't count against limits |
| **Findings** | agent + prompt version + model + thinking + **the boxes and arrows it saw** + requirements version + ids/versions of fetched memory + the brief | A re-review after a small edit reruns only the agents whose context changed |
| **Embeddings** | Hash of the text | Nothing embedded twice |
| **Web pages** | URL + lifetime | Same page not fetched again |

- Keyed on what each agent **saw**, not the whole board — otherwise any edit empties the cache.
- **No semantic cache** ("similar question → same answer") except for general questions with no board, from global knowledge only.
- Never shared between rooms (except global); `cache_hits_total` per cache in Grafana; a "Re-run fresh" button skips it.

## Build plan (each step measured before the next)

| Step | What | Done when |
|---|---|---|
| **S0 — M1-32** | Today's agent gets real tools: `check_design` (rules), `ask_user`, `finish`; nudges deleted | Demo boards ≥ 9/10 with no fake user message |
| **Spike — Groq** | `LLM_API_KEY` in the gateway; per-role provider routing with the local fallback (D13); eval: Groq Qwen3.8 27B and gpt-oss-120b, thinking off/on, next to the table in § Models. *The owner creates the account and the key.* | Quality, speed and real free-tier limits measured |
| **S1 — The orchestrator** | Our own small orchestrator (no LangGraph): typed state, the task queue (D4–D6), findings on the blackboard (D7), merge rules (D8), prompts ordered for the prefix cache and the findings cache (D16), every step a span in Phoenix | Unit tests with a fake LLM; a review runs through the queue with one specialist |
| **S2 — Main + Planner** | The Main agent and the Planner (Groq, thinking) writing briefs from templates, with the clarify loop (D2, D3); flows F2, F6, F1 | Planner eval (right agents, right facts, ≤ 2 rounds of questions); F2 at least as good as S0 |
| **UX/UI pass** | After the agents work end to end: progress view (D6), the Room knowledge panel and citations (D15), Critic result shown, then the whole app's UX and UI | Milestone UX pass: every journey on laptop, phone and keyboard |
| **S3 — First specialists** | Data and Security (rules first, then the agent explains), then Cost and Stack & Cloud (catalogue + prices in code) | Each with its eval boards; no regression on F2 |
| **S4 — More flows** | F4 (change), F5 (deep dive), F3 (draft, with the Planner and Draw mode) | Each flow has its e2e journey (fake LLM) and its eval |
| **S5 — Critic, Scribe, memory** | Code checks + LLM Critic (D9, D14); Scribe with the decision log and ADR export; room memory (D12: structured lookups first, hybrid search for chat); F7, F8 | Fewer rejections in Phoenix feedback; a retrieval eval (the right decision fetched for a question) |
| **S6 — The rest** | Chaos and Traffic (with the A1 simulator), DevOps, Researcher (Groq browser search or SearXNG) writing to the web cache | Per specialist, measured |

Each step is its own ticket (or a few), written when we get there.
