# General rules

Apply everywhere: `apps/*` and `packages/*`. Frontend and backend specifics: [frontend.md](frontend.md), [backend.md](backend.md), [e2e.md](e2e.md). Why things are built this way: [architecture.md](../architecture.md).

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

- MUST NOT: folders or files named `shared`, `common`, `misc`, `utils.ts`, `helpers.ts`. Name things by what they are. (ESLint checks code files; a test in `tooling/lint` checks every file git tracks.)

## No magic strings

- MUST NOT: model ids (`claude-haiku-5-5`, `qwen/qwen3.8-27b`…), provider URLs or provider names written in code. They live as data in **one** place, the gateway's catalogue (`packages/ai-gateway/src/catalogue.ts`); code reads them there. Which model a role uses is configuration (`LLM_ROLE_*`), never code. (Lint checks model ids and provider URLs; tests and recorded fixtures may name a model.)
- MUST NOT: behaviour that branches on a name (`if (model === 'claude-sonnet-5-5')`, `model.startsWith('openai/gpt-oss')`). Put what differs in the catalogue's entry (a field) and read the field.
- MUST NOT: the same knowledge in two places (a URL, a list of providers, a "this model can't turn thinking off" rule). The second copy is a reason to promote it (frontend.md's promotion rule applies everywhere).
- SHOULD: other repeated literals that mean something (a limit, a timeout, a header name) become a named constant next to the code that owns them, with a comment saying why that value.

## Imports and boundaries

- MUST: respect the dependency rules in [architecture.md §3](../architecture.md#3-repo-layout-and-dependency-rules), [§5.2](../architecture.md#52-rules), [§6.1](../architecture.md#61-structure). Lint enforces them.
- MUST: cross a module or pod boundary only through its `index.ts`.
- MUST NOT: circular imports.

## Readability (ADR-014)

The owner reviews specs, rules and architecture; CI reads the code for them. So what a reviewer would catch by eye is a lint error:

- MUST: a function stays under **80 lines** and **15 of cognitive complexity** (`sonarjs/cognitive-complexity`); a file under **300 lines** (blank lines and comments not counted; tests excepted).
- MUST: files over a limit when the rules arrived are listed in `tooling/lint/src/readabilityDebt.ts` and only warn. The list only shrinks: a test fails if it grows, or if a listed file is no longer over a limit (then it leaves the list). Paying it down: ticket CI-02.
- MUST NOT: add a file to the debt list, or raise a limit, to make a PR pass. Split the function instead.

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
- MUST: third-party GitHub Actions (anything not `actions/*` or `github/*`) are pinned to a full commit SHA with the version in a comment (`uses: owner/action@<sha> # v1.2.3`). A tag can be moved to different code; a SHA can't. Dependabot keeps the SHAs up to date.

## Decisions

- MUST: every decision — the owner's, or one made while building — is written down **in the same PR** that makes it, in two places: an ADR in [decisions.md](../decisions.md) (a new one, or a dated line in the ADR it changes) and the architecture doc it touches ([architecture.md](../architecture.md), or [agents/architecture-v2.md](../agents/architecture-v2.md) for the agents). A decision only in a PR description, a chat or a night note doesn't count.
- MUST: a decision that changes an earlier one says so in both places ("replaces D5", "ADR-004 superseded by ADR-012"), so the docs never hold two answers to one question.

## Git

- Branch per ticket: `m1-05-board-types`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org) with the ticket id — `feat(domain): M1-05 add board schemas`, `test(agent): M1-18 loop stops after max rounds`, `fix(review): rename prop per review`.
- MUST: small PRs — one ticket per PR; if a ticket's diff passes ~400 lines, split the ticket. CI's `pr-size` check fails above 400 changed lines of code (lockfile, fixtures, JSON, docs and tickets not counted); only the owner's `large-ok` label lets one through (ADR-014).
- MUST: `main` only changes through a green PR; squash merge. The PR title follows the same commit format (it becomes the commit on `main`).
- Enforced by commitlint: locally by the Lefthook `commit-msg` hook, in CI by the `commitlint` job.
- Process details: [workflow.md](../workflow.md).
