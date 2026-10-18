## Ticket

<!-- e.g. M1-05 — link to the ticket section -->

## What changed

<!-- 2–4 bullets -->

## Why

<!-- the problem this solves; link ADRs if a decision was made -->

## How to test

<!-- commands and clicks a reviewer can follow -->

## Review

<!-- Local AI review (/code-review): findings, what was fixed (fix(review) commits), what was skipped and why -->

## Screenshots / recording

<!-- UI changes only -->

## Checklist

- [ ] Tests written first; `pnpm test` green
- [ ] `pnpm lint` and `pnpm typecheck` green (boundary rules included)
- [ ] `pnpm test:e2e` green (if UI or API changed)
- [ ] Follows [docs/rules](../docs/rules/) — or the exception is explained above
- [ ] Ticket acceptance criteria ticked
- [ ] Learning-log entry added
