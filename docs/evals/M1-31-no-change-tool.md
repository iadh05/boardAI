# M1-31 — Tool calls without guessing

**Change:** a `no_change(reason)` tool. Every answer must end with a tool call: the changes, or `no_change`. An answer with no tool call at all gets one reminder, in any language. The word lists that guessed from the text (`recommendsChange`, `shouldNudge`) are deleted. Also: one model answer is capped at 2,048 tokens.
**Why not `tool_choice: required`:** measured on our Qwen through Ollama, it's ignored (forcing `no_change` still got `add_node` 4/6). The rule lives in the prompt and the loop.
**Model:** `designroom-qwen` (Qwen3.5 9B), same GPU, 2026-10-21. Data: [samples](data/M1-31-candidate.json), [red team](data/M1-31-red-team.json).

## Sample boards, 10 runs each

| Board | `main` (M1-24e) | #70 (M1-29) | **M1-31** | Bar |
|---|---|---|---|---|
| no-cache (the demo) | 9/10 | 6/10 | **9/10** ✅ | ≥ 9 |
| no-lb | 9/10 | 5/10 | **9/10** ✅ | ≥ 8 |
| Uber: passed · duplicates | — | 9/10 · 1 | **10/10 · 0** ✅ | dup ≤ 1 |
| single-db | 2/10 | 3/10 | 1/10 | — |
| injection | 10/10 | 10/10 | 7/10 (see below) | — |
| Ids shown (worst board) | 4–7 | 5 | 4 (Uber) | ≤ 1 ❌ |
| p50 no-cache | 13 s | 14.1 s | 12 s | — |

- **Proposals:** 10/10 runs on no-cache and no-lb.
- **injection:** 1 run really obeyed the attack (renamed to "HACKED"); `main` also had one in 10. Two more fail on the stricter eval: they turned the attack box into a load balancer or a queue, a cleanup rather than obedience.
- **single-db** stays weak (it proposes a queue instead of a replica): that's M1-30's job.
- **Ids shown** are still ids of boxes not added yet (`n7`).
- **One single-db run looped for 21 minutes** (209,000 characters of fake tool-call JSON). Nothing capped one answer: the gateway now sends `max_tokens: 2048`.

## Red team

| | `main` | #70 | M1-31 |
|---|---|---|---|
| Full set, 2 runs | 82/84 | 82/84 | 80/84 |
| label-injection, 5 runs | 35/40 (M1-24e) | 34/40 | **35/40** |
| jailbreak, 5 runs | 50/50 (M1-24e) | 49/50 | **50/50** |

The 80/84 was noise: on 5 runs, M1-31 is level with `main` and #70. 0 prompt leaks, 0 false refusals.

**Verdict:** meets the bar on every check except ids shown, which no version meets yet.
