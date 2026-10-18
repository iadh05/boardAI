# Frontend rules — `apps/web`

Builds on [general.md](general.md). Structure explained in [architecture.md §5](../architecture.md#5-front-end--appsweb).

## Structure

- MUST: business code lives in `modules/<module>/pods/<pod>/`. A pod contains only `components/`, `hooks/`, `mappers/`, optional `lib/`, and `index.ts`. Create a folder only when its first file arrives.
- MUST: other code imports a pod only through its `index.ts`, and a module only through `modules/<module>/index.ts`.
- MUST: module dependency direction is `chat → board`. `board` never imports `chat`.
- MUST: **promotion on the 2nd use** — when a second pod needs something, move it up to the module folder of the same kind (`modules/<m>/hooks/`, `mappers/`, `lib/`). When a second module needs it: to `core/` if it has no business knowledge, to `@designroom/domain` if the server needs it too. Never copy-paste instead.
- MUST: `core/` knows nothing about boards, chat or any module. If it mentions a node, it doesn't belong in `core/`.
- MUST: `app/` holds providers and pages; `layout/` holds page templates. No business logic in either.

## Components and atomic design

- MUST: **atoms** (Button, Icon, Input, Spinner…) exist only in `core/ui/atoms`. Pods build from them.
- MUST: `core/ui` components are pure presentation: props in, events out. No store, no React Query, no fetch.
- SHOULD: pod components are molecules/organisms that compose `core/ui`; keep them thin — logic goes in hooks, transformations in mappers.
- MUST: one component per file; props type named `<Component>Props`; function components only.
- MUST: React Flow `nodeTypes` / `edgeTypes` objects are defined at module level, never inside a component.
- SHOULD: no `useMemo`/`useCallback`/`memo` "just in case" — add them when a profile or a lint rule shows a need, and say so in a comment.

## State

| Kind | Tool | Rule |
|---|---|---|
| Client state | **Zustand**, one store per module in `modules/<m>/store/` | Actions live in the store and call `@designroom/domain` ops — no rules duplicated in components |
| Server state | **TanStack Query** | Query keys come from a per-module key factory (`chatKeys.all`, …). Never copy server data into Zustand |
| View state | Component state or React Flow's internal store | Selection, viewport, open/closed panels |

- MUST: read stores with a **selector** (`useBoardStore((s) => s.nodes)`), never the whole store.
- MUST NOT: Redux. React Context only for providers/dependency injection, not for app state.
- MUST: stores are testable without React (`useBoardStore.getState()`), with a reset helper for tests.

## Data and API

- MUST: network calls live in `core/api` (generic transport) or a module's `api/` (feature calls). Components never call `fetch`.
- MUST: every response and SSE event is parsed with the `@designroom/domain` schema before it enters a store.
- MUST: mappers are pure functions with tests (`toFlow`, `placement`).

## Styling — Tailwind

- MUST: Tailwind utility classes; no CSS files except the Tailwind entry and React Flow's stylesheet.
- MUST: colours, spacing and radii come from the theme tokens; arbitrary values (`w-[137px]`) only with a comment.
- SHOULD: inline `style` only for runtime values (positions, sizes from data).
- SHOULD: class order handled by `prettier-plugin-tailwindcss`.

## Accessibility

- MUST: clickable things are `<button>` or `<a>`, never a `div` with `onClick`.
- MUST: every input has a label (visible or `aria-label`); icon-only buttons have `aria-label`.
- MUST: visible keyboard focus; everything in the toolbar and chat works with the keyboard.

## Testing

- MUST: stores, mappers, `lib/` and hooks with logic are TDD'd with Vitest.
- MUST: component tests use React Testing Library and query by **role/label/text**, not class names or test ids (test ids only as a last resort).
- MUST: user flows that cross modules (add/connect nodes, chat → proposal → Accept) are covered by Playwright in `apps/web/e2e/`, running against the fake LLM.
- MUST: Playwright tests use role-based locators and web-first assertions (`await expect(locator).toBeVisible()`), never fixed `waitForTimeout`.

## Errors and observability

- MUST: one error boundary in `app/` reporting to Sentry; module-level boundaries where a crash shouldn't take the page down (chat panel).
- MUST: Sentry init only in `core/observability`; disabled when the DSN is unset.
