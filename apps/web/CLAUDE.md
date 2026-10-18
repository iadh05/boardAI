# apps/web — frontend

React + Vite + Tailwind. Structure and reasons: [docs/architecture.md §5](../../docs/architecture.md#5-front-end--appsweb).

Follow these rules for every change here (they are also enforced by lint where possible):

@../../docs/rules/frontend.md

Quick reminders:
- Business code lives in `src/modules/<module>/pods/<pod>/` (`components/ hooks/ mappers/ lib/ index.ts`); cross a pod or module only through its `index.ts`. Direction: `chat → board`.
- Atoms only in `src/core/ui/atoms`; `core/` knows nothing about modules.
- Client state: Zustand store per module (`modules/<m>/store/`), read with selectors. Server state: TanStack Query. No Redux.
- Tests: Vitest + Testing Library, query by role/label/text; Playwright for cross-module flows.
- Tailwind utilities only; theme tokens, no magic values.
