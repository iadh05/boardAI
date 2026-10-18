# Tickets

Each milestone has one file. Each ticket is a section with an ID like `M1-04`.

| File | Tickets | Detail level |
|---|---|---|
| [M1-solo-board.md](M1-solo-board.md) | M1-01 … M1-27 (+ 01b, 01c, 03b, 14b, 19b) | Full — ready to start |

Tickets for later milestones are written when that milestone's spec is written. You'll know much more by then.

## Workflow

- **Status** is one of `todo` → `doing` → `done` (or `blocked: <reason>`). Status lives only in the ticket.
- Only **one** ticket in `doing` at a time.
- A ticket is `done` when every acceptance criterion is ticked **and** its tests pass.
- If a ticket grows past ~2 days, split it (`M1-07a`, `M1-07b`).
- Found something out of scope? Add it to "Later" in [MILESTONES.md](../MILESTONES.md), don't do it now.
- Commit messages reference the ticket: `M1-04: add React Flow canvas`.

## Ticket template

```markdown
## M<n>-<nn> — <Title>
**Status:** todo · **Size:** S (≤½ day) | M (1 day) | L (2 days) · **Depends on:** M<n>-<nn>

**Why:** one or two sentences.

**Learning goal:** the concept this ticket teaches.

**Tasks**
- [ ] …

**Acceptance criteria**
- [ ] Observable, testable outcome.

**Hints** (read only if stuck)
- …

**Stretch** (optional)
- …
```

## Moving to GitHub Issues later

Each `## M…` section maps 1:1 to an issue (title = heading, body = section, label = milestone). If you push this repo to GitHub you can create them with `gh issue create`, one per section.
