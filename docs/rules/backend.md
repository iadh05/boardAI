# Backend rules — `apps/server` and `packages/*`

Builds on [general.md](general.md). Structure explained in [architecture.md §6–8](../architecture.md#6-back-end--appsserver).

## Modular monolith

- MUST: each feature is a module in `src/modules/<module>/` exposing `createXxxModule(deps)` from its `index.ts`, which returns at least `{ routes }` (a Hono sub-app).
- MUST: modules talk to each other only through `index.ts` — as if the other module were a remote service.
- MUST: all wiring happens in `main.ts` (the composition root). No module creates its own dependencies or reads another module's.
- MUST NOT: module-level singletons or mutable global state. State lives in objects created by factories and injected.
- MUST: routes are mounted under `/api/<module>` (health is `/api/health`).

## Four layers (modules with logic)

| Layer | Contains | MUST NOT |
|---|---|---|
| `api/` | Hono routes: parse + validate input (zod), call one use case, map result/errors to HTTP, stream SSE | contain business rules; touch infra directly |
| `application/` | Use cases: orchestrate domain + ports; declare the interfaces (ports) they need | import Hono types (`Context`, `Request`), read env, know a provider's wire format |
| `domain/` | Pure rules and policies | do I/O, read env, use `Date.now()`/random directly (inject a clock/id generator), import `api/` or `infra/` |
| `infra/` | Adapters implementing application ports (LLM, DB later) | be imported by `domain/` |

- SHOULD: a module with only trivial pass-through (e.g. `health`) stays flat.

## Packages

- MUST: `@designroom/domain` depends only on `zod`. No I/O, no framework.
- MUST: `@designroom/ai-gateway` depends on no internal package. It is the **only** code that talks to an LLM provider.
- MUST: `@designroom/agent` imports from `ai-gateway` with `import type` only; the gateway is injected.
- MUST: every package has its own tests and a single public `index.ts`.

## Input, output, errors

- MUST: every request body, query and param is validated with zod in `api/`; invalid → `400` with details.
- MUST: error responses use one shape: `{ "error": { "code": "BOARD_TOO_LARGE", "message": "…", "details": … } }`.
- MUST: domain errors are typed (`code` union) and mapped to HTTP status in one place (`core/errors.ts`).
- MUST: env is read **only** in `core/config.ts` (zod-validated at startup). Lint forbids `process.env` elsewhere.

## AI and agent safety

- MUST: the agent has no destructive tools (no delete). Adding one needs an ADR.
- MUST: every tool argument is zod-validated, and every op is checked with `applyOps` on a draft board before it can reach a proposal.
- MUST: board content and chat text are passed to the model as **data**, clearly delimited — never concatenated into the system prompt.
- MUST: every external call (LLM, later DB/Redis) has a timeout; the agent loop has a max-rounds limit.
- MUST: when the client disconnects, the request's `AbortSignal` cancels the LLM call (no GPU work for nobody).
- SHOULD: prompt changes are logged in the learning log with the sample-boards result (seed of M5 evals).

## Async

- MUST NOT: floating promises (lint `no-floating-promises`).
- MUST: streams (SSE, LLM) always end with a terminal event (`done` or `error`) — never just stop.

## Logging and observability

- MUST: log through `core/logger` (structured JSON, includes request id + trace id).
- MUST: one span per use case, per agent round, per LLM call (attributes: model, tokens, latency).
- MUST: metric names `snake_case` with unit suffix (`llm_request_duration_seconds`, `llm_tokens_total`).
- MUST: unexpected errors go to Sentry from the Hono error handler; expected domain errors don't.

## Testing

- MUST: `domain/` → pure unit tests, written first.
- MUST: `application/` → tests with fakes for every port (fake LLM, fake clock).
- MUST: `api/` → `app.request()` tests: validation errors, status codes, SSE event order.
- MUST NOT: tests that need Ollama, Docker, or the network. The real model is only used by scripts in `scripts/`.
