# apps/server — backend

Hono modular monolith. Structure and reasons: [docs/architecture.md §6](../../docs/architecture.md#6-back-end--appsserver).

Follow these rules for every change here (they are also enforced by lint where possible):

@../../docs/rules/backend.md

Quick reminders:
- New feature = a module in `src/modules/<name>/` exposing `createXxxModule(deps)` from `index.ts`; wire it in `main.ts`.
- Modules with logic use `api/ → application/ → domain/`, with `infra/` implementing ports. Lint (`boundaries/dependencies`) rejects wrong-direction imports.
- Env only in `core/config.ts`; no `console`; every input validated with zod; tests never touch the network or a real LLM.
