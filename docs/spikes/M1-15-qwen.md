# Spike M1-15 — Qwen tool calls on the local GPU

**Date:** 2026-10-19 · **Machine:** RTX 5060 Ti 16 GB, NVIDIA driver 616.56, Ollama 0.40.4
**Scripts:** [scripts/spike-tool-call.ts](../../scripts/spike-tool-call.ts) (measurements) ·
[scripts/record-fixture.ts](../../scripts/record-fixture.ts) (raw streams for M1-16)

## Verdict

**`qwen3.5:9b`, thinking off, 16k context** — served as `designroom-qwen` (Modelfile below). Every tool call was correct, it is the fastest (≈ 64 tok/s,
answer starts in < 1 s), and it uses 6 GB of the 16 GB, so context can grow cheaply.
`qwen3:14b` stays the fallback: also correct, but slower (≈ 41 tok/s), and its VRAM grows fast
with context.

## Results

Same 4-node board (client → LB → API → Postgres), same 3 prompts, sampling from the model card
(temperature 0.7, top_p 0.8, top_k 20, presence_penalty 1.5 — Ollama accepts all four). Median of 3.

| Model | Thinking | VRAM (`ollama ps`) | On GPU | Context | First token | Answer starts | Total | Tokens/s | Correct calls |
|---|---|---|---|---|---|---|---|---|---|
| `qwen3.5:9b` | off | 6.1 GB | 100 % | 16k | 0.9 s | **0.9 s** | 0.9–2.2 s | **64.5** | 3/3 |
| `qwen3.5:9b` | on | 6.1 GB | 100 % | 16k | 0.3 s | 4.0 s | 6.9 s | 63.9 | 3/3 |
| `qwen3:14b` | off | 11.7 GB | 100 % | 16k | 0.8 s | 0.8 s | 2.5 s | 40.9 | 3/3 |
| `qwen3:14b` | on | 11.7 GB | 100 % | 16k | 0.2 s | 12.0 s | 13.5 s | 40.5 | 3/3 |

- **"First token" lies when thinking is on**: the first token is a *thinking* token the user never
  sees. What matters is when the answer starts. Thinking costs 4 s (9b) to 12 s (14b) per answer for
  the same score — off it goes.
- **3/3 everywhere = the prompts are too easy** to separate the models. Differences show up in the
  details instead (below). The real comparison comes with the 15 flawed diagrams of M5.

### What the calls looked like

- **9b, thinking off** calls one tool, explains in text, and — given the tool result back
  ("added node n5") — follows up with the right `connect_nodes(n3 → n5)`. That is exactly the loop of
  architecture §7.
- **14b** calls several tools **at once** and guesses the ids of nodes it hasn't created yet
  (`connect_nodes(n3 → n5)` in the same answer as `add_node`). That works only if our ids happen to be
  `n5`, `n6`… → the agent must reject ids it doesn't know (the tool error lets the model retry).
- **14b with thinking** wired the queue straight to the database in prompt 2 (wrong), and without
  thinking renamed the API to a `service` nobody asked for after the tool result.
- **9b with thinking** added an unrequested "Image Cache" next to the queue. More thinking ≠ smaller
  changes.

## Context length and VRAM

| Model | 16k | 32k | 64k |
|---|---|---|---|
| `qwen3.5:9b` | 6.1 GB | 6.7 GB | 7.7 GB — all 100 % GPU |
| `qwen3:14b` | 11.7 GB | 14.4 GB | max is 40k: 16.3 GB, **only 90 % on GPU** |

Qwen3.5's linear-attention layers (Gated DeltaNet, full attention every 4th layer) show: +0.6 GB per
extra 16k, against +2.7 GB for Qwen3. With 9b we could go to 64k if long chats need it.
Our prompts are tiny: ~680 tokens for system + tools + board + question.

## Context length — the OpenAI endpoint's trap

The OpenAI-compatible endpoint has no way to pass Ollama's `num_ctx`, and it loaded `qwen3.5:9b` with
**4096 tokens** of context. Fine for today's ~680-token prompt; a big board plus a long chat would be
**cut off silently**. Fix: [infra/ollama/Modelfile](../../infra/ollama/Modelfile) bakes 16k context and the
sampling into our own model — `ollama create designroom-qwen -f infra/ollama/Modelfile` → loads with
16384 tokens, 6.1 GB, 100 % GPU. The server's `LLM_MODEL` is `designroom-qwen`.

## Turning thinking off — it depends on the endpoint

Qwen3.5 thinks by default, and the old `/no_think` switch is gone. Measured on "What is 17×23?":

| Endpoint | Request field | Thinking? | Time |
|---|---|---|---|
| native `/api/chat` | `think: false` | no | — |
| OpenAI `/v1/chat/completions` | *(nothing)* | **yes** | 21 s |
| OpenAI | `think: false` | **yes — ignored** | 4.6 s |
| OpenAI | `chat_template_kwargs: { enable_thinking: false }` | **yes — ignored** | 9.0 s |
| OpenAI | `reasoning_effort: "none"` | no | 0.2 s |
| OpenAI | `reasoning: { effort: "none" }` | no | 0.2 s |

→ **The ai-gateway (M1-16) uses the OpenAI-compatible endpoint with `reasoning_effort: "none"`.**
Thinking arrives as `delta.reasoning` (not `content`); the gateway must skip it (or count it), never
show it as the answer.

## The stream, as the gateway will see it

Recorded in [packages/ai-gateway/src/providers/fixtures/](../../packages/ai-gateway/src/providers/fixtures/) (moved there in M1-16):

- `openai-tool-call.sse` — text deltas, then **one chunk with the whole tool call**
  (`arguments` is a complete JSON string), `finish_reason: "tool_calls"`, a usage chunk, `[DONE]`.
- `openai-tool-call-thinking.sse` — the same with hundreds of `reasoning` deltas first.
- `openai-text-only.sse` — plain text answer, `finish_reason: "stop"`.

Ollama sends tool calls whole; OpenAI/Azure send `arguments` in pieces — the gateway still assembles
by `index`, tested with a hand-made split fixture.
With `stream_options.include_usage`, the last chunk carries `usage` (tokens) **and** Ollama's
`timings` (prompt and generation speed) — free metering for M1-24.

## Not done

- `qwen3.6:35b` with CPU offload (optional): skipped, 9b already does the job.
- Driver/Ollama updates: already recent, nothing to do.
