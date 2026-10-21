# Agent V2 — tickets

The build plan of [architecture-v2.md](../docs/agents/architecture-v2.md#build-plan-each-step-measured-before-the-next), as tickets. Written 2026-10-21 for the night of 21 → 22 October (owner: "complete the whole multi-agent tonight"). Status lines are kept current through the night; the morning report is [the night notes](#night-log).

**Rules for the night**
- Each ticket = one branch = one PR, stacked in the order below. Agent/prompt PRs are **not merged**: the owner reviews them.
- V2 runs **behind a flag** (`AGENT_MODE=v2`) until AV2-10's eval says it is at least as good as V1. Users keep V1 until then.
- Everything is TDD with the fake LLM; measured with `scripts/review-samples.ts` on the real models.
- Decisions taken alone are logged in each ticket under **Night decisions**, for the owner to overturn.

| ID | Step | Title | Size | Status |
|---|---|---|---|---|
| AV2-01 | S0 | Single agent with tools: `check_design`, `ask_user`, `finish` (= M1-30 + M1-32a) | M | doing |
| AV2-02 | gateway | The gateway speaks Groq and Gemini | S | todo |
| AV2-03 | gateway | Claude through the official SDK, with a spend guard | M | todo |
| AV2-04 | gateway | A model per role, with the local fallback (D13) | S | todo |
| AV2-05 | S1 | The orchestrator: typed state, task queue, findings, merge | L | todo |
| AV2-06 | S3 | First specialists: Data and Security | M | todo |
| AV2-07 | S2 | Planner and Main agent: flows F1, F2, F6, the clarify loop | L | todo |
| AV2-08 | S5 | Critic: code checks, then an LLM on another model | M | todo |
| AV2-09 | wiring | V2 behind `AGENT_MODE=v2`: server, progress events, e2e | M | todo |
| AV2-10 | eval | V1 vs V2 on every sample board; keep or not | S | todo |

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

---

## Night log
Kept as the night goes (times are local).

- 2026-10-21 evening: tickets written. AV2-01's rules and tools done (uncommitted at that point, worktree `C:/Users/Benab/wt/dr-m1-32`). Hosted probes: Groq, Gemini, Claude keys work; findings in AV2-02 and AV2-03.
