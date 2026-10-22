# Eval — V1 vs V2 on hard questions (2026-10-22)

**Script:** [scripts/hard-eval.ts](../../scripts/hard-eval.ts) · **Model:** local `designroom-qwen` (Qwen3.5 9B) for every agent; the hosted Planner on Groq Qwen3.8 27B with thinking · **Runs:** 6 cases × 3 setups × 5 runs

Six cases V1's design rules don't already catch: security, cost, hidden single points of failure, consistency, global latency. A run passes when the answer names the real problem (and, where the fix is a box, proposes it). **A run where the Planner asks questions instead of answering counts as not passing.**

| Case | Question | V1 | V2 local | V2 + hosted Planner |
|---|---|---|---|---|
| exposed-db | the browser reads the card DB directly — "Review my design." | 3/5 | 0/5 (4 asked) | 3/5 |
| deep-dive | same board — "Is my database safe?" | 1/5 | 3/5 (2 asked) | **5/5** |
| over-engineered | Kafka + 3 DBs + CDN — "100 users, $50/month. Review." | 4/5 | 2/5 (3 asked) | 4/5 |
| hidden-spof | 2 APIs, 1 worker, 1 DB — "What is the single point of failure?" | 5/5 | 5/5 | 5/5 |
| dual-write | DB then Kafka — "Can we lose an order event?" | 1/5* | 0/5 (1 asked) | 0/5 |
| global-latency | all in eu-west — "US users need < 100 ms." | **5/5** | 0/5 (5 asked) | 3/5 (1 asked) |
| **total** | | **19/30** | **10/30** (15 asked) | **20/30** (1 asked) |
| time p50 (answers) | | 10.5 s | 16.7 s | 15.5 s |

\* A false positive of the pass pattern: "make sure the save is durable before publishing" is not the outbox pattern. No setup knows the fix.

## What the answers show

1. **V2 wins on security.** On "Is my database safe?", V2 names the direct browser → database access, why it's dangerous (credentials in client code), and proposes a gateway; V1 talks about a replica and misses it (5/5 vs 1/5).
2. **V2 answers its findings, not the question.** On dual-write and global latency, V2's answer is about the rule specialists' usual findings (replica, cache) instead of what was asked — and on global latency it often proposes nothing.
3. **Consistency is nobody's job:** 0/5 everywhere on dual-write (outbox / transactional publishing).
4. **V2 needs the hosted Planner:** the local 9B Planner asks questions in half the runs (15/30); on Groq, 1/30.

## Verdict

V2 with the hosted Planner is **as good as V1 overall** (20 vs 19, within noise) and **clearly better on security deep dives** — not better yet across the board. Next, in [tickets/agent-v2.md](../../tickets/agent-v2.md) AV2-11d: the Architect answers the question first and uses the findings as support; the local Planner asks less (D2); a consistency check (dual write → outbox). Then re-run this eval.
