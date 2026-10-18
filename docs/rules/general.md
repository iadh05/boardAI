# General rules

Apply everywhere: `apps/*` and `packages/*`. Frontend and backend specifics: [frontend.md](frontend.md), [backend.md](backend.md). Why things are built this way: [architecture.md](../architecture.md).

**MUST** = CI or review blocks it. **SHOULD** = default; break it only with a reason in the PR.

## TypeScript

- MUST: `strict` mode; no `any` — use `unknown` and narrow it.
- MUST: no non-null assertion (`x!`) without a comment saying why it's safe.
- MUST: data crossing a boundary (HTTP body, SSE event, env var, LLM output, tool arguments) is validated with zod before use. Types come from `z.infer`, not hand-written twice.
- SHOULD: expected failures return `Result<T>` (`{ ok: true, value } | { ok: false, error }`); throw only for bugs and unexpected I/O failures.
- SHOULD: prefer `type` unions and plain objects over classes; use a class only when it holds real state.
- MUST: named exports only (no `export default`), so renames are safe and imports greppable.

## Naming

| Thing | Convention | Example |
|---|---|---|
| React component file | `PascalCase.tsx` | `SystemNode.tsx` |
| Other file | `camelCase.ts` | `boardStore.ts`, `toFlow.ts` |
| Test file | next to the code, `.test.ts(x)` | `toFlow.test.ts` |
| Folder | `kebab-case` (one word preferred) | `ai-gateway`, `canvas` |
| Hook | `useXxx` | `useSendMessage` |
| Factory | `createXxx(deps)` | `createChatModule` |
| Zod schema / type | `XxxSchema` / `Xxx` | `BoardSchema` / `Board` |
| Constant | `UPPER_SNAKE_CASE` | `KNOWN_KINDS` |

- MUST NOT: folders or files named `shared`, `common`, `misc`, `utils.ts`, `helpers.ts`. Name things by what they are.

## Imports and boundaries

- MUST: respect the dependency rules in [architecture.md §3](../architecture.md#3-repo-layout-and-dependency-rules), [§5.2](../architecture.md#52-rules), [§6.1](../architecture.md#61-structure). Lint enforces them.
- MUST: cross a module or pod boundary only through its `index.ts`.
- MUST NOT: circular imports.

## Testing (TDD)

- MUST: logic is written test-first: red → green → refactor.
- MUST: no test touches the network, a real LLM, or the system clock without a fake.
- MUST: tests describe behaviour (`it('removes edges attached to the deleted node')`), not implementation.
- SHOULD: one reason to fail per test; arrange–act–assert layout.
- MUST: a bug fix starts with a failing test that reproduces it.

## Errors and logging

- MUST NOT: `console.log` in committed code (lint). Use the logger (server) or Sentry (web).
- MUST NOT: log secrets, tokens, full prompts or full boards at `info` level.
- MUST: user-facing error messages say what happened and what to do ("Can't reach the model — is Ollama running?").

## Security

- MUST: secrets only in `.env` (git-ignored); `.env.example` lists every variable with a fake value.
- MUST: anything from the user or the LLM is **data, never instructions** — never `eval`, never build shell commands or HTML from it unescaped.

## Git

- Branch per ticket: `m1-05-board-types`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org) with the ticket id — `feat(domain): M1-05 add board schemas`, `test(agent): M1-18 loop stops after max rounds`, `fix(review): rename prop per review`.
- MUST: small PRs — one ticket per PR; if a ticket's diff passes ~400 lines, split the ticket.
- MUST: `main` only changes through a green PR; squash merge.
- Process details: [workflow.md](../workflow.md).
