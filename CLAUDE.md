# DesignRoom (boardAI)

Real-time system-design whiteboard with an AI reviewer. **Learning project**: the owner is learning by building. Explain decisions and trade-offs, ask before large changes, and prefer guiding over writing whole features unasked.

- Roadmap: @MILESTONES.md
- Architecture: @docs/architecture.md
- Current tickets: tickets/ (status lives in each ticket)
- Workflow (branch → PR → review → merge): @docs/workflow.md

## Rules

@docs/rules/general.md
@docs/rules/frontend.md
@docs/rules/backend.md
@docs/rules/e2e.md

## Commands

```bash
pnpm dev            # web + server
pnpm test           # unit tests (no network, no Ollama)
pnpm test:e2e       # Playwright, fake LLM
pnpm lint           # includes boundary rules
pnpm typecheck
docker compose up -d   # Nginx (http://localhost:8080) + Grafana
```
