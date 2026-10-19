# End-to-end test rules — Playwright (`apps/web/e2e`)

Builds on [general.md](general.md) and [frontend.md](frontend.md). E2E tests check **user flows across modules in a real browser**; logic belongs in unit tests.

**MUST** = CI or review blocks it. **SHOULD** = default; break it only with a reason in the PR.

## What gets an E2E test

- MUST: each flow from the M1 demo script (add/connect/delete nodes, chat → proposal → Accept/Reject, "proposal out of date") has an E2E test.
- SHOULD NOT: test what a unit test can (validation rules, mappers, store logic). E2E is slow; keep the suite small and meaningful — think *one test per user journey*, not per component.

## Structure — Page Object Model (POM)

```
e2e/
├─ pages/           # one class per page or major region: what a user can see and do
│  ├─ AppPage.ts
│  ├─ CanvasRegion.ts
│  └─ ChatPanel.ts
├─ fixtures.ts      # test.extend: gives every test ready-made page objects
├─ data/            # builders for test data (boards, fake-LLM scenarios)
└─ *.spec.ts        # the journeys, written in user language
```

- MUST: specs import `test` / `expect` from `./fixtures.ts`, not straight from `@playwright/test`, and get page objects as fixtures (`async ({ app }) => …`). No `new AppPage(page)` in specs.
- MUST: **locators live in page objects only.** A spec never calls `page.getByRole(...)` — when the UI changes, one file changes.
- MUST: page-object methods are **user actions and questions** named in domain words: `addNode('database')`, `connect('API', 'Orders DB')`, `sendMessage('review my design')`, `nodeNamed('Cache')` — not `clickButton3()`.
- MUST: page objects **don't assert**. They return locators or values; specs make the assertions with `expect`. (One exception: a `waitUntilReady()`-style method may wait for the page to be usable.)
- SHOULD: regions that appear on several pages (canvas, chat panel) are their own page objects, composed by the page (`app.chat.sendMessage(…)`).
- SHOULD: keep page objects thin — no `if`s or loops that hide behaviour from the spec.

## Locators

- MUST: by role, label or visible text (`getByRole`, `getByLabel`, `getByText`), the same way a user or screen reader finds things. `data-testid` only when there's truly no accessible handle — and then it's a hint the UI may have an accessibility gap.
- MUST NOT: CSS/XPath selectors tied to classes or DOM structure (Tailwind classes change all the time).

## Waiting

- MUST: web-first assertions that retry until true (`await expect(locator).toBeVisible()`).
- MUST NOT: `page.waitForTimeout()` / fixed sleeps. If you need to wait, wait for the thing (a locator, a response, a URL).
- MUST: every `await` that triggers navigation or a request is followed by an assertion on its *result*, not on timing.

## Retries and flaky tests

- Config: **0 retries locally, 1 retry in CI** — the retry exists only to record a **trace** of the failure (`trace: 'on-first-retry'`).
- MUST: `failOnFlakyTests` is on in CI. A test that fails and then passes on retry is **flaky**, and flaky **fails the build**. A retry never turns red into green.
- When a test is flaky:
  1. Open the trace from the `playwright-report` artifact; find the race (usually a missing wait-for-result or shared state).
  2. Fix it in the same PR if it's yours.
  3. If it can't be fixed now: mark it `test.fixme('reason + ticket id')`, open a ticket, and link it. **No skipped test without a ticket.**
- MUST NOT: raise retries, raise timeouts, or add sleeps to make a flaky test pass.
- MUST: `forbidOnly` in CI — a stray `test.only` can't silently skip the rest. Lint also rejects any `.only(...)` (`test.describe.only` included) in all e2e files.

## Test data and isolation

- MUST: each test starts from a known state and doesn't depend on another test's leftovers or order (`fullyParallel: true`).
- MUST: test data is built in the test (or via `e2e/data/` builders), visible in the spec — no hidden shared fixtures that several tests mutate.
- MUST: the AI is always the **fake LLM** (`LLM_PROVIDER=fake` + a scenario file) — never the real model. Results must be deterministic. Playwright starts that server itself on :3100 and `vite preview` forwards `/api` to it; scenarios are in `e2e/fixtures/llm/scenarios.json`, chosen by text in the user's message.
- SHOULD: when the app gains persistence (M2/M3), seed and clean data through the API, not by clicking through the UI.

## Naming and tags

- Spec files by journey: `board-editing.spec.ts`, `ai-review.spec.ts`.
- Test titles describe what the user achieves: `test('accepting a proposal adds the cache node', …)`.
- SHOULD: tag the critical path with `@smoke` (`test('…', { tag: '@smoke' }, …)`) so a quick subset can run with `--grep @smoke`.

## Running

```bash
pnpm test:e2e                                       # builds, serves the production build, runs Chromium
pnpm --filter @designroom/web exec playwright test --ui   # interactive mode while writing tests

# Faster loop while writing tests: build + serve once, Playwright reuses the running server
pnpm --filter @designroom/web build && pnpm --filter @designroom/web preview --port 4173
pnpm --filter @designroom/web exec playwright test        # in a second terminal
BASE_URL=http://localhost:8080 pnpm test:e2e        # same tests through Nginx (M1-14b)
```

A failed CI run uploads `playwright-report` (HTML report + traces): download it and run `npx playwright show-report` on it.
