# Spike AV2-11 — The harness: our runtime vs XState v5

**Date:** 2026-10-22 · **Machine:** RTX 5060 Ti 16 GB, local `designroom-qwen` (Qwen3.5 9B), Planner with thinking
**Code:** branch `spike-xstate` (not merged) — `packages/agent/src/application/reviewerXState.ts`,
`scripts/spike-xstate-bench.ts`, `scripts/spike-xstate-real.ts`, `scripts/spike-planner-diff.ts`
**Question (the owner):** can the harness — the orchestrator's engine — be XState instead of our own runtime (ADR-011)?

## How it was compared

Both harnesses run **the same six nodes** (`createChainNodes`: scope, plan, tasks, next, architect, critic); only the engine and the wiring differ. Same tests, same fake models, then the same real model.

## Results

| | Our runtime (#92/#93) | XState 5.33.3 |
|---|---|---|
| V2's behaviour tests (14, fake models) | ✅ 14/14 | ✅ 14/14, the same file |
| Pause and resume (interrupt / persisted snapshot) | ✅ test: 22 lines | ✅ test: 37 lines |
| What the Planner's model receives | identical (checked call by call) | identical |
| Harness overhead per review (300 runs, fake models) | p50 **0.47 ms** · p95 0.85 ms | p50 **0.62 ms** · p95 1.03 ms |
| Real review, local model | 7–28 s | 7–34 s — the model's time; no difference |
| Code we own | **266 lines** (engine 207 + wiring 59) | **186 lines** (machine 118 + glue 68); the engine is the library |
| The wiring itself (the chain's order) | 59 lines: one edge per line | 118 lines: each state repeats invoke / guard / assign |
| Dependency | none (2.2 KB minified) | +51 KB minified, 16 KB gzip; 2.6 MB on disk |
| Visual | Mermaid by hand | Stately editor / inspector can draw and watch the machine (not tried in this spike) |
| Maturity | ours: building V2 on it found a lost-events bug (fixed in #92) | years in production, timers, parallel states, child actors built in |

## A false lead, and a real finding

- The first real runs showed XState's reviews "asking questions" 7 times in 11, ours 0 in 11. Not the harness: the Planner received the same messages; run alone, each harness asked in 2–3 of 5 runs. The gap came from the order of calls on the GPU (Ollama's cache), not from XState.
- **The real finding:** for a plain "Review my design." the Planner asks clarifying questions about **half the time** (AV2-11d).

## Verdict

**Either works; nothing measured forces the choice.** Behaviour, speed and real runs are the same. The trade-off is ownership against wiring:
- **Ours:** half the wiring, no dependency, already built and reviewed (#92/#93) — but we own the engine and its bugs.
- **XState:** a mature engine and a visual inspector — twice the wiring, written in its vocabulary, a new dependency.

The decision is the owner's; it is recorded in ADR-011 when made.
