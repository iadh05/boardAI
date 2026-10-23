# V1 vs V2 on a ladder: easy to hard, small to big (2026-10-23)

`scripts/ladder-eval.ts`, scale 1, 3 runs per setup, local Qwen3.5 9B (`designroom-qwen`); the
hosted Planner is Groq's `qwen/qwen3.8-27b` with thinking. Each level is a harder question on a
bigger board; the flaw sits among healthy subsystems (service → cache, service → database →
replica) that should draw no change. Raw runs (input, output, every model call by role) stay in
the git-ignored `eval-runs/`.

| Level | Boxes | V1 | V2 local | V2 hosted Planner |
|---|---|---|---|---|
| L1 missing cache (said by the user) | 3 | 3/3 | 0/3 | 3/3 |
| L2 one API instance, 10k users | 8 | 3/3 | 2/3 | 3/3 |
| L3 hidden SPOF (one worker) | 20 | 1/3 | 0/3 | 1/3 |
| L4 dual write (outbox) | 32 | 0/3 | 0/3 | 1/3 |
| L5 exposed DB + far users + budget | 45 | 2/3 | 0/3 | 0/3 |
| L6 follow-up: no second region | 65 | 0/3 | 1/3 | 0/3 |
| **Total** | | **9/18** | **3/18** | **8/18** |

Also measured, per level: questions asked instead of answering (V2 local: 9 of 18 runs; V1 and
the hosted Planner: 1), changes on the healthy parts (off-target ops: V1 8, V2 local 11, V2
hosted 18), time (V2 is 1.5–2.5× slower from L3 up) and input tokens (8–25k per review).

## Diagnosis (from the saved runs)

1. **Our own rule is the main failure at scale, not the model.** `duplicates`
   (`packages/domain/src/board/designChecks.ts`) counts every cache as one job: a cache per
   service — normal — becomes "6 boxes do the same job: keep one". Both V1 (its design check) and
   V2 (the data specialist) receive it, believe it, and spend the answer merging healthy caches:
   that is most of the off-target ops, and the reason L3–L5 answers miss the real problem. It grows
   with the board, which is why it only showed up here.
2. **The Planner's understanding never reaches the Architect.** On L4 the hosted Planner's plan
   says the gap is "between writing to Orders DB and the event landing in Kafka" — the outbox
   problem — yet the Architect (local 9B) only gets the specialists' findings, not the plan, and
   answers about caches. `reviewerV2` passes `findings` and `critique` to the Architect, nothing
   from the plan. The Planner was meant to brief the others (the "prompt engineer" idea); today it
   only routes.
3. **The local Planner asks when it shouldn't.** L1: the user said what was wrong; it asked for
   the read/write mix anyway (2 of 3). L5: 3 of 3. The hosted Planner (thinking, 27B) asked once in
   18 runs.
4. **Nobody knows the outbox fix on their own** (L4), as in the hard-question eval: it needs the
   Planner's insight (2.) or knowledge (RAG, D12).
5. **L6 (pushback) is weak everywhere:** all setups still propose a US region or proxy after the
   user refused one. The scoring here is strict (any new box named "us…" fails).

## What to change, in order

1. Fix `duplicates`: boxes of one kind do the same job only when they serve the same thing (same
   neighbours), not when they share a kind. A test with one cache per service first.
2. Give the Architect the Planner's brief (its assumptions and focus) next to the findings.
3. Re-run the ladder at scale 1 and 2 after each change; the saved runs show what moved.

## Follow-up: ruling out the model (2026-10-23)

Same 18 questions; the L3 and L6 rules were fixed first (they failed correct answers: "a single
Payment worker", a CDN labelled "US + EU edge"), and every saved run was re-scored.

| Setup | Score |
|---|---|
| V2 local (all Qwen 9B) | 3/18 |
| V2, Planner on Groq qwen3.8 27B | 8/18 |
| V1, Qwen 9B | 9/18 |
| V2, Planner on Claude Sonnet 5.5 | 9/18 |
| V2, plans written by hand in the session (rest local) | 11/18 |
| V1 on Claude Sonnet 5.5 | 13/18 |

- A stronger model helps a single agent (V1: 9 → 13; L4 dual write 0/3 → 3/3).
- A stronger Planner barely helps V2 (9/18): Sonnet's L4 plan named the dual write exactly, and
  the answer still failed 3 times out of 3. The plan never reaches the Architect, and the Planner
  can only pick a flow and two fixed rule specialists: it can't brief or dispatch anyone.
- Even Sonnet as V1 misses L5/L6 twice in three: it starts with check_design, as the Architect
  prompt says, and follows the checks before the user's problem.

Conclusion: V2's main problem is the architecture, not the model: (1) the Planner as a real
orchestrator (a brief, and which agents to call), (2) the Architect prompt (the question and the
brief before the checks), (3) the misleading checks.
