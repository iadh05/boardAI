# AV2-10 — Agent V1 vs V2 on the sample boards

**Date:** 2026-10-22 (night of 21 → 22) · **Model:** `designroom-qwen` (Qwen 3.5 9B, thinking off), 100 % GPU · **Script:** `node --env-file=apps/server/.env scripts/review-samples.ts --runs 5 --mode v1|v2 [--planner groq:qwen/qwen3.8-27b+think] [--critic]` · **Boards:** the five samples of [M1-24](M1-24-prompt.md) (no-cache, single-db, no-lb, injection, uber), "Review my design.", 5 runs each.

| Setup | Passed | no-cache | single-db | no-lb | injection | uber | Time p50 (per board) | Errors |
|---|---|---|---|---|---|---|---|---|
| **V1** — one agent with `check_design` / `finish` (AV2-01) | **23/25** | 3/5 | 5/5 | 5/5 | 5/5 | 5/5 | 7–16 s | 0 |
| V2, all local | 22/25 | 4/5 | 4/5 | 4/5 | 5/5 | 5/5 | 9–15 s | 0 |
| V2, Planner on Groq Qwen3.8 27B, thinking on (D13) | **23/25** | 3/5 | 5/5 | 5/5 | 5/5 | 5/5 | 8–19 s (p95 up to 52 s: free-tier 429 waits) | 0 |
| V2 + Critic (code checks only) | 22/25 | 3/5 | 4/5 | 5/5 | 5/5 | 5/5 | 9–18 s | 0 |

Earlier the same night, V1 (AV2-01) scored 47/50 and 45/50 on 10 runs per board; tonight's 23/25 is within that range. Main before AV2-01: 19/25.

## Reading

- **V2 is as good as V1 here — not better — and a little slower.** Every difference is inside the noise of 5 runs (a 95 % range of ±30 points per board).
- **That was expected from these boards:** each tests a flaw V1 already finds with `check_design` (missing cache, load balancer, single database, a duplicate). V2's Data specialist runs the *same* rules; its other value (the Security specialist, deep dives, the Planner's questions) isn't tested by any sample board yet.
- On **uber**, V2 proposed less (2/5 runs) and asked more (3/5 "asked only"): the Planner asks about numbers on a large board, which the pass rule (no duplicate) doesn't punish but a user would notice.
- The **hosted Planner** doesn't change the pass rate; on the free tier its 429 waits make the slow runs much slower (p95 52 s).
- The **Critic's code checks** found nothing to send back in 25 runs: the tools already refuse what they check (kind changes were 0 in every setup).

## Recommendation

**Keep `AGENT_MODE=v1` as the default for now.** Before switching:
1. Add eval boards for what V2 adds: Security (a client reaching a data store, no gateway), data deep dives ("will Postgres survive a crash?"), questions that need the Planner to ask back. Without them, no eval can show V2 is better.
2. Measure the Planner's questions on large boards (uber): ask less, state assumptions more.
3. Turn the Critic's LLM on (`LLM_ROLE_CRITIC`, another model family) only with boards where code checks pass but the proposal is still wrong.

## The Planner on its own (2026-10-22)

`node --env-file=apps/server/.env scripts/plan-samples.ts --runs 3 [--provider groq|gemini --model … --think]` — 10 requests on the demo board, right flow and specialists:

| Planner model | Right plans | Asked questions |
|---|---|---|
| **Groq Qwen3.8 27B, thinking on** | **30/30** | 4/30 |
| **Gemini 3.5 Flash-Lite** | **30/30** | 2/30 |
| Local Qwen 3.5 9B, thinking off | 26/30 | 7/30 |
| Gemini 3.5 Flash | 21/30 | 0/30 — all 9 misses are exactly the fallback plan: its answer probably isn't read (thinking on by default), to check in the gateway before judging the model |

A hosted Planner plans perfectly where the local 9B doesn't: D13 holds. Groq Qwen3.8 and Gemini Flash-Lite are equal; the choice is the free-tier limits (Gemini 15 requests/min; Groq 7,000 input tokens/min).
