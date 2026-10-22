# Agent V2 — tickets

The build plan of [architecture-v2.md](../docs/agents/architecture-v2.md#build-plan-each-step-measured-before-the-next), as tickets. Written 2026-10-21 for the night of 21 → 22 October (owner: "complete the whole multi-agent tonight"). Status lines are kept current through the night; the morning report is [the night notes](#night-log).

**Rules for the night**
- Each ticket = one branch = one PR, stacked in the order below. Agent/prompt PRs are **not merged**: the owner reviews them.
- V2 runs **behind a flag** (`AGENT_MODE=v2`) until AV2-10's eval says it is at least as good as V1. Users keep V1 until then.
- Everything is TDD with the fake LLM; measured with `scripts/review-samples.ts` on the real models.
- Decisions taken alone are logged in each ticket under **Night decisions**, for the owner to overturn.

| ID | Step | Title | Size | Status |
|---|---|---|---|---|
| AV2-01 | S0 | Single agent with tools: `check_design`, `ask_user`, `finish` (= M1-30 + M1-32a) | M | in review — #81 (Qwen 45/50, demo 9/10) |
| AV2-02 | gateway | The gateway speaks Groq and Gemini | S | in review — #80 |
| AV2-03 | gateway | Claude through the official SDK, with a spend guard | M | in review — #82 |
| AV2-04 | gateway | A model per role, with the local fallback (D13) | S | in review — #83 |
| AV2-05 | S1 | The orchestrator: typed state, task queue, findings, merge | L | in review — #84 |
| AV2-06 | S3 | First specialists: Data and Security | M | in review — #85 (rules first: see its PR) |
| AV2-07 | S2 | Planner and Main agent: flows F1, F2, F6, the clarify loop | L | in review — #86 (Planner local 26/30) |
| AV2-08 | S5 | Critic: code checks, then an LLM on another model | M | in review — #87 (off by default) |
| AV2-09 | wiring | V2 behind `AGENT_MODE=v2`: server, progress events, e2e | M | in review — #88 (no V2 e2e: see its PR) |
| AV2-10 | eval | V1 vs V2 on every sample board; keep or not | S | in review — #89 (V2 = V1 on these boards: keep v1) |
| AV2-11a | spike | Our state machine vs LangGraph.js, on the hardest flow; ADR | S | todo (added 2026-10-22) |
| AV2-11 | S1+ | State machine + request tracker (built the way AV2-11a decides) | M | todo |
| AV2-12 | D17 | Ad-hoc expert: proposed by the Planner, runs after your Accept | M | todo |
| AV2-13 | D10 | Sub-specialists: one level under a specialist, as briefs | M | todo |

What was built, drawn: [docs/agents/v2/built-2026-10-22.json](../docs/agents/v2/built-2026-10-22.json) (`node scripts/board-snapshot.mjs load docs/agents/v2/built-2026-10-22.json`).

Later (not tonight): M1-32b round budget, M1-32c question card (folded into AV2-09's progress events if it fits), the knowledge store and Scribe (D12, D15), caches (D16), threads (D19), the ad-hoc expert (D17), Cost / Stack & Cloud / Chaos / Traffic / DevOps / Researcher specialists, the UX pass.

---

## AV2-01 — Single agent with tools (S0)
**Status:** doing · **Size:** M · **Depends on:** M1-31 · **Same as:** M1-30 + M1-32a ([M1-solo-board.md](M1-solo-board.md#m1-32--agent-v2-tools-to-check-ask-and-finish))

**Why:** add tools before agents. Today's agent can't look, ask or finish, and is pushed by reminders written as the user.

**Tasks**
- [x] `checkDesign(board)` in `@designroom/domain`: no load balancer, no cache, one database copy, duplicates, unconnected boxes; each finding names its boxes and the fix.
- [x] Tools `check_design` (on the draft), `ask_user(question)`, `finish(summary)`; `no_change` removed; ≤ 8 tools.
- [ ] The loop: `finish` / `ask_user` end the answer; `finish` refuses a floating new box (an observation); no tool call → one `[format error]` observation; `nudge.ts` deleted.
- [ ] Prompt v4; server tests; e2e fake scenarios end with `finish`, plus the journey "a review that needs numbers asks a question".
- [ ] Eval on Qwen: 5 boards × 5 runs vs the baseline (22/25), demo board 10 runs.

**Acceptance criteria**
- [ ] Demo board ≥ 9/10 with no fake user message in the loop.
- [ ] Every rule the agent follows is in a tool description or checked in a tool's code.

## AV2-02 — The gateway speaks Groq and Gemini
**Status:** todo · **Size:** S · **Depends on:** —

**Why:** measured 2026-10-21, both failed for gateway reasons, not model reasons: Gemini's tool-call chunks have no `index` (our schema requires it → "a chunk we cannot read", 6/6 runs); Groq validates tool arguments on its server and fails the request (4/6 Qwen3.8 runs) instead of letting our loop answer; free-tier 429s ended 3 runs.

**Tasks**
- [ ] Recorded fixtures (real responses, keys never stored): a Gemini tool-call stream, a Groq `tool_use_failed` error, a Groq 429 with `retry-after`.
- [ ] `index` optional (a call's position in the array when absent).
- [ ] Gemini's `extra_content.google.thought_signature` kept on the tool call (an opaque `providerData` field) and sent back with it; checked with a two-round call on the real API.
- [ ] Groq `tool_use_failed`: its `failed_generation` becomes a normal tool call, so the agent's zod check answers the model.
- [ ] 429: `LlmError` carries `retryAfterMs`; the gateway waits it (capped) before retrying, only before the first chunk.
- [ ] Thinking per model as data: `reasoning_effort` value or omitted (gpt-oss can't be `none`; some Gemini models 400 on `none`).

**Acceptance criteria**
- [ ] The three fixtures pass as unit tests; Ollama's existing tests unchanged.
- [ ] `review-samples.ts --provider groq|gemini` runs a whole eval with no gateway error.

## AV2-03 — Claude through the official SDK, with a spend guard
**Status:** todo · **Size:** M · **Depends on:** AV2-02 (shared types)

**Why:** the owner's call: Haiku 5.5 and Sonnet 5.5 only, **$100 max**. Claude speaks its own Messages API; the official SDK parses its stream and keeps up with API changes (thinking rules changed in 2026).

**Tasks**
- [ ] `providers/anthropic.ts` on `@anthropic-ai/sdk` (`maxRetries: 0`: the gateway retries): messages, tools (`input_schema`), tool results, streamed text and tool calls, usage, typed errors → `LlmError`, `AbortSignal`.
- [ ] Thinking off: Haiku `{ type: "disabled" }`, Sonnet `{ type: "between_tools" }` (effort ≤ high); on: adaptive + effort.
- [ ] Only `claude-haiku-5-5` and `claude-sonnet-5-5` accepted (config, zod).
- [ ] Spend guard: cost per call from `usage` × price table; a daily cap (`LLM_DAILY_BUDGET_USD`, default 5) refuses past it; `llm_cost_usd_total` metric.
- [ ] `CLAUDE_API_KEY` read only in `core/config.ts`; `.env.example` updated.

**Acceptance criteria**
- [ ] Unit tests on recorded fixtures (no network); a real review runs on Haiku and Sonnet through the same agent.
- [ ] The owner sets a $100 limit in the Anthropic Console (an account setting: theirs).

## AV2-04 — A model per role, with the local fallback (D13)
**Status:** todo · **Size:** S · **Depends on:** AV2-02, AV2-03

**Tasks**
- [ ] Config: a role → `{ provider, model, thinking }` table (`main`, `planner`, `specialist`, `critic`), each with the local 9B as fallback.
- [ ] Fallback on `UNAVAILABLE` / 429 past the wait / budget reached / provider switched off (`LLM_HOSTED=off`).
- [ ] The role and the model that answered on every LLM span (Phoenix shows who did what).

**Acceptance criteria**
- [ ] With no keys set, every role runs on the local model (today's behaviour).
- [ ] A unit test: the planner's provider fails → the local model answers, and the span says so.

## AV2-05 — The orchestrator (S1)
**Status:** todo · **Size:** L · **Depends on:** AV2-01

**Why:** V2's backbone, our own (no LangGraph): one queue on one GPU, typed contracts between agents, merge in code.

**Tasks**
- [ ] Typed state for one request: plan, tasks, findings (blackboard), board version, progress.
- [ ] Task card `{ id, specialist, boxIds, question, budgetMs }` (D4); queue: one task at a time, ≤ 6 tasks, 60 s each, Stop cancels the running and waiting tasks (D5).
- [ ] Finding `{ specialist, boxIds, severity, problem, fix?, confidence }`, zod-checked, stamped with the board version (D7).
- [ ] Merge in code (D8): dedupe by box + problem type, sort by severity, a conflict table.
- [ ] Progress events (D6): "Data ✓ · Security running · 1 left".
- [ ] A span per task, per agent call (Phoenix tree: request → plan → each task → merge → critic).

**Acceptance criteria**
- [ ] Unit tests with the fake LLM: a review runs through the queue with one specialist; a 61 s task times out; Stop cancels.

## AV2-06 — First specialists: Data and Security (S3)
**Status:** todo · **Size:** M · **Depends on:** AV2-05

**Tasks**
- [ ] Rules first, in `@designroom/domain`: Data (`checkDesign`'s database rules + data stores with no backup or replica), Security (a database or service reachable from a client without an API or gateway in front, an external provider called without a gateway).
- [ ] Each specialist: a brief template, its rules as a tool, returns typed findings; read-only (no board changes: the Architect proposes).
- [ ] Eval boards: one per rule with the flaw, one clean (no false findings).

**Acceptance criteria**
- [ ] Each specialist finds its flaw on its eval boards and nothing on the clean one, ≥ 4/5 runs.

## AV2-07 — Planner and Main agent (S2)
**Status:** todo · **Size:** L · **Depends on:** AV2-04, AV2-05, AV2-06

**Tasks**
- [ ] Main agent (level 1): trivial turns answered alone (D3); relays everything else; writes the final answer from the merged, checked proposal.
- [ ] Planner (level 2, thinking on, hosted with local fallback): picks the flow (F1 question, F2 review, F6 decision tonight), what is ambiguous, the tasks and their briefs from templates.
- [ ] Clarify loop (D2): at most 2 rounds, 3 questions each, only for what changes the answer; then proceed with stated assumptions.
- [ ] Architect: tasks → queue; merge (AV2-05); the proposal through `applyOps` on a draft (the same ops and caps as V1).

**Acceptance criteria**
- [ ] Planner eval: right flow and right specialists on 10 scripted requests ≥ 9/10.
- [ ] F2 review on the demo boards at least as good as AV2-01.

## AV2-08 — Critic (S5, D9 + D14)
**Status:** todo · **Size:** M · **Depends on:** AV2-07

**Tasks**
- [ ] Code checks first: `applyOps` ok, no duplicates, every new box connected, no kind changed, ≤ 3 new boxes.
- [ ] LLM Critic on another model family (hosted, thinking on): `{ verdict: pass | revise, issues }`; `revise` goes back to the Architect **once**.
- [ ] Off by default until measured (`AGENT_CRITIC=on`).

**Acceptance criteria**
- [ ] Unit tests: a failing proposal is revised once, then shown with its issues; the eval shows fewer wrong proposals or the Critic stays off.

## AV2-09 — V2 behind `AGENT_MODE=v2`
**Status:** todo · **Size:** M · **Depends on:** AV2-07

**Tasks**
- [ ] Server: `createReviewAgent` picks V1 or V2 from config; same `ChatEvent` stream plus `progress` (and `question`, M1-32c) events in the contract.
- [ ] Web: progress line in the chat while V2 works; the question card.
- [ ] e2e (fake LLM): a V2 review shows progress, then a proposal to accept.
- [ ] `docs/architecture.md` §4.4, §7, §12 updated.

**Acceptance criteria**
- [ ] `AGENT_MODE=v1` (default) is unchanged; the e2e suite passes in both modes.

## AV2-10 — V1 vs V2 eval
**Status:** todo · **Size:** S · **Depends on:** AV2-09

**Tasks**
- [ ] `review-samples.ts --mode v1|v2`: every sample board, 5 runs each; local only, then with hosted roles.
- [ ] One table in `docs/evals/` and architecture-v2 § Models: pass rate, wrong proposals, time p50/p95, cost.
- [ ] Recommendation for the owner: switch the default, or not yet and why.

## AV2-02b — Providers apart, the chain as configuration (ADR-012)
**Status:** todo · **Size:** M · **Depends on:** #91 merged

**Tasks**
- [ ] `wire/openaiChat/`: the OpenAI Chat Completions format only, moved out of `openAiCompatible.ts` with its tests.
- [ ] `providers/ollama/`, `groq/`, `gemini/`, `claude/`: each provider's quirks, fixtures and tests in its folder; the catalogue stays the one list of models.
- [ ] `chain.ts`: `LLM_ROLE_*=a > b > c`; next link only before the first chunk; local always last; `llm_fallback_total{from, to, reason}`.
- [ ] Policies around any provider: spend cap (out of `anthropic.ts`), rate limit.

**Acceptance criteria**
- [ ] A Gemini change touches only `providers/gemini/` (checked by reading the diff of a one-line Gemini fix).
- [ ] Unit tests: a three-link chain moves on 429, on silence, on budget; never after the first chunk.

## AV2-11a — Read LangGraph.js's API, copy its shapes
**Status:** todo · **Size:** XS · **Depends on:** —

**Why:** the ad-hoc expert (AV2-12) needs a request to **pause for your Accept and resume on your next message**, and sub-specialists (AV2-13) need the Planner to decide the number of tasks at runtime. `reviewerV2.ts` is a straight line of `if`s with no saved state, so it can do neither. **Decided by the owner (2026-10-22, ADR-011): our own state graph, shaped like LangGraph, no LangGraph dependency.** So no two-way spike: read the current LangGraph.js docs so our names and shapes match theirs (what we know of the API is from memory).

**Tasks**
- [ ] Read the current docs for `StateGraph`, reducers/annotations, `addConditionalEdges`, `interrupt()` + `Command({ resume })`, `Send`, checkpointers and stream modes; note anything ADR-011's design gets wrong.
- [ ] Update ADR-011's design section with the owner; set it to accepted.

**Acceptance criteria**
- [ ] ADR-011 accepted, co-written with the owner.

## AV2-11 — Our state graph: runtime, checkpoints, interrupts, streaming
**Status:** todo · **Size:** M (split if the diff passes ~400 lines: runtime first, then V2 moved onto it) · **Depends on:** AV2-11a, AV2-09 merged

**Tasks**
- [ ] A small runtime in `packages/agent` (TDD, fake LLM): `StateGraph` with a zod-typed state and reducers, `addNode`, `addEdge`, `addConditionalEdges`, `interrupt()`, `compile({ checkpointer })`, `stream()`.
- [ ] Named states: `scoping → planning → asking | awaiting_approval → running → writing → critiquing → done`, and `stopped | failed` from any state. An edge not in the graph is a test failure.
- [ ] Checkpoint after every node, per conversation (in memory now, the Yjs room doc in M2): your next message resumes a paused request.
- [ ] Interrupts: `asking` and `awaiting_approval` end the request with a `paused` event; resume with the next message.
- [ ] A queue per hardware resource: model calls from graph nodes wait in their resource's queue (local GPU: 1 at a time; hosted: a few, within the rate limit). Shared across requests, user-facing steps first; Stop drops a request's waiting calls. Fan-out in the graph, one-at-a-time in the queue.
- [ ] Streaming: `node_started`, `text`, `card`, `finding`, `node_done` over the existing SSE stream (zod schemas in `@designroom/domain`); the chat shows a live checklist instead of a progress sentence.
- [ ] Tracker (from the checkpoints): per request, the plan, each card (with `parent` and `brief`), status, timing, findings; per ad-hoc definition, proposed / accepted / used.
- [ ] One Phoenix span per node, with the state's version.
- [ ] Move `reviewerV2.ts` onto the graph; V1 untouched.

**Acceptance criteria**
- [ ] Unit tests: every transition, resume after a pause, Stop in every state, a 2-card fan-out within the 6-card budget.
- [ ] e2e: a review shows the live checklist; a paused request resumes on the next message.
- [ ] AV2-10's eval: V2 on the graph no worse than before.

## AV2-11b — The Planner orchestrates (ADR-011)
**Status:** todo · **Size:** M · **Depends on:** AV2-11

**Tasks**
- [ ] The Planner is asked at each decision point: plan, re-plan once after the cards, finished.
- [ ] Its plan is zod-checked data; invalid → back once with the reason → the flow's default plan.
- [ ] Missing context (D21): `needs` on the finding contract; fill it board → memory → web → you; one re-run per card; the answer saved as a requirement; `context_missing_total`.

**Acceptance criteria**
- [ ] Unit tests with the fake LLM: a re-plan adds a card within budget; two invalid plans run the default; a `needs: user` pauses and resumes.
- [ ] A run on the sample boards printed step by step (state after each node).

## AV2-14 — Proposals as separate changes; the Architect aligns conflicts (ADR-013, D23)
**Status:** todo · **Size:** L — split: (a) contract + Accept per change, (b) the Architect's grouping and align step, (c) the card, feedback and memory per change · **Depends on:** AV2-11b

**Tasks**
- [ ] `Proposal { changes[] }` and `Change` in `@designroom/domain` (zod), with `dependsOn` and `composed`; `applyOps` per change, in order, against the current board.
- [ ] From the merged findings: agreeing ones → one change each; conflicting ones (D8) → the Architect's align step → one composed change (why + what it replaced).
- [ ] Dependencies computed from the ops (a connect to a box another change adds).
- [ ] Chat card: one checkbox per change, hover highlights its ghost boxes, "Accept selected" / "Reject all"; each accepted change its own undo step.
- [ ] Feedback (D18) and room memory (D12) per change.

**Acceptance criteria**
- [ ] Unit: three agreeing findings → three changes; a Cost vs Chaos conflict → one composed change; rejecting a change unticks the one depending on it.
- [ ] e2e: accept DevOps' change, reject Cost's: only DevOps' boxes land; the feedback names each agent.

## AV2-12 — Ad-hoc expert (D17)
**Status:** todo · **Size:** M · **Depends on:** AV2-11

**Tasks**
- [ ] The Planner may propose an expert `{ role, focus, boxIds }` when no specialist fits, as a top-level card or a sub-brief under a specialist.
- [ ] `awaiting_approval`: the chat shows an Accept / Reject card; Reject continues without it.
- [ ] `createAdhocExpert(brief)`: the specialist model, **no tools**, read-only, the finding contract, counted in the 6-task budget.

**Acceptance criteria**
- [ ] Unit + e2e: proposed → accepted → its findings reach the Architect; rejected → the review goes on without it.

## AV2-13 — Sub-specialists (D10)
**Status:** todo · **Size:** M · **Depends on:** AV2-11, Data/Security as LLM agents

**Tasks**
- [ ] The Planner picks sub-briefs (Data → model · storage · consistency; Stack & Cloud → stack · cloud) as cards with `parent`.
- [ ] The queue stays flat: one card at a time, ≤ 6 in all. A specialist never spawns agents; it may return "needs a deeper look", and the Architect adds the card if the budget allows (depth ≤ 1).
- [ ] Merge sub-cards under their parent first, then with the others.

**Acceptance criteria**
- [ ] Unit tests: a 3-sub-brief Data review stays within budget; a "deeper look" request beyond the budget is refused and said.

---

## Night log
Kept as the night goes (times are local).

- 2026-10-21 evening: tickets written. AV2-01's rules and tools done (uncommitted at that point, worktree `C:/Users/Benab/wt/dr-m1-32`). Hosted probes: Groq, Gemini, Claude keys work; findings in AV2-02 and AV2-03.
- AV2-01: Qwen 9B 19/25 (main, tonight) → 47/50, then 45/50 after the review fixes; demo board 9/10. PR #81.
- AV2-02: free-tier limits measured — Groq Qwen3.8 7,000 input tokens/min, Gemini 3.5 Flash-Lite 15 requests/min; hosted eval 0 gateway errors (was 12). PR #80.
- AV2-03: Claude via the SDK, Haiku 9/10 and Sonnet 8/10 runs on V1's agent; review found a per-role budget, uncounted early stops, temperature 400s, dropped thinking blocks — fixed. PR #82.
- AV2-04: a model per role; review found a silent hosted model never fell back — fixed with a first-chunk deadline. PR #83.
- AV2-05 … AV2-09: orchestrator, rule specialists, Planner + Main + Architect, Critic, wiring behind `AGENT_MODE=v2`. PRs #84 … #88. Planner on local Qwen 24/30 → 26/30.
- **Night decisions** (all in the night notes and the PRs): specialists are rules (AV2-06); the Architect is AV2-01's agent fed with the findings (AV2-07); the D2 clarify limit counts assistant turns (stateless server); the Critic holds the answer and is off by default (AV2-08); no V2 e2e journey yet (AV2-09).
- Review of AV2-05 … AV2-09 (AI, read-only): blocking — Stop or a model error inside V2 was thrown as a server bug; fixed (V2 ends with an error event, then done, like V1). Also fixed: a task ignoring its signal could hang the queue; labels could close the Critic's blocks; the Critic kept going after Stop; a stale progress line.
- AV2-10 (5 runs × 5 boards, local Qwen, 0 errors): **V1 23/25 · V2 local 22/25 · V2 with a Groq thinking Planner 23/25 · V2 + Critic 22/25.** V2 as good as V1 on these boards, not better, a little slower — they only test what `check_design` already finds. Recommendation: keep `AGENT_MODE=v1`; add Security and deep-dive eval boards first. PR #89. All PRs #79–#89 green in CI.
