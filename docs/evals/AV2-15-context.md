# AV2-15 — Context for the Architect: plan, question first, one "same job" rule

**Dates:** 2026-11-02 → 2026-11-04 · **Architect model:** local `designroom-qwen` (Qwen 3.5 9B, thinking off), 100 % GPU, unless said · **Ladder:** `scripts/ladder-eval.ts` from #115 (not merged; run from a copy), scale 1 · Decision: [ADR-015](../decisions.md).

## Why

On the ladder, V2 was no better than V1 (V1 9/18, V2 with a hosted Planner 8/18, 2026-10-23). In the saved runs the Planner named the dual write on L4 and the Architect never saw it: `reviewerV2` passed only the findings, and the prompt said to explain them first.

## 1. Context test, before building (L4 dual write, 32 boxes)

The plan and a knowledge card added by hand to the Architect's message; nothing else changed.

| Architect got | Qwen 9B local (5 runs) | Groq Qwen3.8 27B (3 runs) |
|---|---|---|
| Today: no plan, no card | **0/5** | **0/3** |
| A plan naming the dual write | **5/5** | **3/3** |
| An outbox card only | 4/5 | 3/3 |
| Plan + card | 5/5 (fix on the board 3/5) | 3/3 (fix on the board 3/3) |
| Control: the card on an unrelated question | 5/5, never says outbox | — (Groq daily limit) |

- gpt-oss-120b on Groq: not usable as the Architect today — no text in any run, one tool call per round, always at the round limit.
- A stronger model alone doesn't solve it (27B: 0/3); the context does.

## 2. The ladder, after the change

| Setup | Before (10-23, main) | After |
|---|---|---|
| V2, hand-written plans (best case) | 11/18 | **16/18** |
| V2, Planner on Gemini 3.5 Flash-Lite | — (Groq: 8/18) | **13/18** (16/18 on the first commit, before the review fixes) |
| V2, all local | 3/18 | 8/18 |
| V1 (5 runs per level, same day) | main **15/30** | **19/30** |

- V1 gets prompt v5 and the rule too: no regression, a little better (L3 3/5 → 5/5, L6 1/5 → 4/5; L4 and L5 still 0–2/5).
- Off-target changes (on healthy subsystems), V1: 6 on main, 6 after — but on main they were merges of healthy caches ("Universal cache"); after, extra arrows and boxes near healthy services.
- **L4 with Gemini's own plans: 0/3 on the final commit.** Its plans blamed Kafka or the consumer, not the dual write: the Architect now follows the plan, so the Planner's insight decides. Knowledge cards (D12) are the next step for what the Planner doesn't know.

## 3. Guardrails and sample boards

- **Red team** (prompt v5, 1 run, 42 attacks): 40/42 stopped, 0 leaks, 0 false refusals of 16 honest questions.
- **Label injection, 3 runs:** 19/24 after vs 23/24 on main. All 5 failures read by hand: none obeyed — 4 name the injected box by its label (unquoted) while calling it an unconnected box, which the judge counts as the marker; 1 wrote a tool call as text. A judge fix (match the label loosely) is a follow-up, not done here.
- **Sample boards** (V1, 5 runs, first commit): 5/5 samples pass; one uber run hit the 60 s idle timeout.
- **The plan leaking into the answer** ("your colleague's concern…"): 1/18 to 3/54 runs; the plan block was reworded on the last commit (no "colleague"), not measured since.

## Limits

3–5 runs per cell: only big gaps count. Groq's free tier (200k tokens/day) can't hold one full ladder; the Groq rows are the context test only.
