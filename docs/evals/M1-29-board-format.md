# M1-29 — How the board reaches the model

**Question (owner, 2026-10-20):** is the board better given to the model as text, SVG or an image? Tried before deciding.
**Model:** `designroom-qwen` (Qwen3.5 9B, Q4_K_M, thinking off), RTX 5060 Ti, 100 % GPU. Spike scripts kept out of the repo; they called Ollama directly because the gateway carries text only.

## 1. Text vs SVG vs screenshot

Four boards (no-cache, single-db, no-lb: 4–6 boxes; Uber: 18 boxes, 19 arrows), 5 runs per board × format.

- **Text:** the agent's board text, at the time `n1 [client] "Rider app" -> n3 ("assets")`.
- **SVG:** what an "export as SVG" gives: boxes with label and kind, arrows with markers and labels.
- **Image:** a screenshot of the real canvas, toolbar and minimap hidden: what the user sees, cut-off labels included.

**Reading test:** "list every box and every arrow", scored against the board.

| Board | Text | SVG | Image |
|---|---|---|---|
| Small boards, arrows found | 100 % | 80–100 % | 100 % |
| Uber, arrows found | 79 % | 47 % | 36 % |
| Uber, input tokens | 678 | 3,807 | 990 |

**Review test:** the real system prompt with "Review my design." The known flaw was named in 14/15 runs with text, 10/15 with SVG and 13/15 with the image. By hand on the Uber answers, the image caused the most claims that something already on the board was missing (3–4/5, e.g. "no load balancer in front of the API Gateway"), against 0–1/5 for text.

**Decision:** keep text. The first run had the toolbar in the screenshot and the model listed buttons as boxes; it was re-run without it, and the numbers above are from the clean screenshot. Vision stays for photo → diagram (A3).

## 2. Which text layout

The text test showed a flaw of its own: in some runs the model read arrow labels as boxes (`-> n4 ("HTTPS")` → "Rider app → HTTPS"). Uber board, reading test, 10 runs each. Bar set before measuring: ≥ 95 % of arrows on average, no run under 80 %, ≤ 50 % more tokens.

| Layout | Example | Arrows found | Worst run | Perfect runs | Tokens |
|---|---|---|---|---|---|
| Before | `n1 [client] "Rider app" -> n3 ("assets"), n4 ("HTTPS")` | 57 % | 5 % | 1/10 | 678 |
| A | `-> n3 (label "assets"), n4 (label "HTTPS")` | 87 % | 68 % | 1/10 | 711 |
| B | `-> n3 "CDN (app assets, map tiles)" (label "assets")` | 83 % | 16 % | 1/10 | 830 |
| **C** | `Boxes:` then `Arrows:` with `n1 -> n3 (label "assets")` | **100 %** | **100 %** | **10/10** | **788** |
| D | C with both ends named | 100 % | 100 % | 10/10 | 1,005 |

- Before: 4 of 10 runs collapsed to ≤ 11 %: every arrow label taken for a box.
- A and B: the same two arrows missed in most runs (Payment Service → PSP, Notifications → Push / SMS), short lines in the middle of the listing; B once stopped after 3 arrows.
- **Chosen: C**: as accurate as D for 22 % fewer tokens.
- Caveat: the reading test asks for a list of arrows, which C already is. The review measurements below check that reviews don't get worse.

## 3. Review measurements (before merge)

All of M1-29 together (prompt B, inventory, permission-only nudge, id rewrite, format C). Same GPU, 2026-10-20. Data: [samples](data/M1-29-candidate.json), [red team](data/M1-29-red-team.json). `main` numbers are M1-24e's shipped version.

| Board, 10 runs | `main` | M1-29 | Proposed | Ids shown | Duplicates* | p50 / p95 |
|---|---|---|---|---|---|---|
| no-cache (the demo) | 10/10 | **3/10** ❌ (bar ≥ 9) | 3/10 | 2 | 0 | 7.4 / 12.9 s |
| single-db | 4/10 | 0/10 | 5/10 | 2 | 2 | 5.8 / 15.2 s |
| no-lb | 9/10 | **6/10** ❌ (bar ≥ 8) | 8/10 | 1 | 1 | 8 / 33.6 s |
| injection | 10/10 | 10/10 | 5/10 | 3 | 0 | 6.1 / 16.5 s |
| Uber after "Kafka or RabbitMQ?" | — | 6/10 pass · **4/10 duplicates** ❌ (bar ≤ 1) | 4/10 | 2 | 4 | 11.2 / 22 s |

\*A new box of a kind already on the board, label included (a "RabbitMQ" box next to Kafka). Strict: by hand, 2 of the 4 Uber ones are real (a RabbitMQ notifications queue, a "ride request buffer" queue); the other two are a second load balancer for payments and a dead-letter queue.

Red team, 2 runs: **84/84 attacks stopped**, 0 leaks, 0/32 false refusals (`main`: 82/84) ✅.

**Why the demo boards dropped:** the nudge now fires only when the answer asks permission. In all 7 no-cache runs without a proposal (and 2/2 no-lb, 6/6 Uber) the answer recommended a fix in words without asking ("Here are the fixes: … add a caching layer"): the old rule would have nudged every one, the new one none.

**Ids still shown (1–3 per board):** ids the board doesn't have yet. The model names a box it means to add (`n5 [cache] "Redis"`, `n19`) and the rewriter only knows existing boxes.

**Verdict:** does not meet the bar; not merged.

### Second round: after the fixes

After reading the answers: the id rewriter no longer doubles names or loses backticks; `add_node` refuses a second queue, cache, load balancer or CDN; the nudge fires on a recommended change unless the answer says nothing must change or only offers it as an option; an empty-board line in the prompt; and the eval now fails a run that changes an existing box's kind (stricter than for `main`). Data: [samples](data/M1-29-candidate-2.json), [red team](data/M1-29-red-team-2.json).

| Board, 10 runs | `main` (M1-24e shipped) | M1-29 round 1 | **M1-29 round 2** | Bar |
|---|---|---|---|---|
| no-cache | 9/10 | 3/10 | **6/10** ❌ | ≥ 9 |
| no-lb | 9/10 | 6/10 | **5/10** ❌ | ≥ 8 |
| single-db | 2/10 | 0/10 | 3/10 | — |
| injection | 10/10 | 10/10 | 10/10 | — |
| Uber: passed · duplicates | — | 6/10 · 4 | **9/10 · 1** ✅ | dup ≤ 1 |
| Ids shown (worst board) | 4–7 | 3 | 5 (Uber) ❌ | ≤ 1 |
| Red team | 82/84 | 84/84 | 82/84 ✅ (= `main`) | no regression |

- **Proposing is back:** no-cache proposed in 10/10 runs (round 1: 3/10). It now fails on *what* it proposes: a queue or replicas instead of the cache (runs 6–8), or three boxes left unconnected (run 2).
- **no-lb:** 4 of the 5 failures propose a queue or a replica instead of the load balancer.
- **Ids shown:** every remaining one is a box that doesn't exist yet ("add `n5 "RabbitMQ"`", "cache node (n19)"). The rewriter only knows existing boxes.
- **Uber:** the remaining duplicate is a `storage` box labelled "Trip Analytics Cache": the guard reads labels only on custom and service boxes.

**Verdict:** the Uber problems are fixed and the red team holds, but the demo boards are below `main`. Not merged.
