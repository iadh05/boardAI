# Workflow — from ticket to merge

One ticket = one branch = one pull request. Pipeline overview: [architecture.md §15](architecture.md#15-delivery-pipeline).

## 1. Start a ticket

1. Pick the next `todo` ticket in [tickets/](../tickets/), set it to `doing`.
2. `git switch main && git pull && git switch -c m1-05-board-types`
3. Re-read the ticket's *Tests first* and *Acceptance criteria*.

## 2. Build it (TDD)

- Red → green → refactor. Commit at each green: `test(domain): M1-05 …`, `feat(domain): M1-05 …`, `refactor(domain): M1-05 …`.
- Follow [rules/](rules/). If a rule gets in the way, don't silently break it — raise it in the PR.

## 3. Self-review before opening the PR

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
```

Then read your own diff top to bottom (`git diff main...`) as if someone else wrote it:
- [ ] Every acceptance criterion is met — tick it in the ticket.
- [ ] No leftover `console.log`, commented-out code, or TODO without a ticket.
- [ ] Names say what things are; no `shared/`/`utils.ts`.
- [ ] Tests describe behaviour and would fail if the feature broke.

## 4. Open the PR

- Title: `M1-05: board types and zod schemas`.
- Fill the template (`.github/pull_request_template.md`): what, why, how to test, screenshots for UI.
- CI runs: `checks`, `unit`, `e2e`. **Red CI = not ready for review.** Fix first.

## 5. Review

Reviewers: you (with fresh eyes, ideally the next day) + an AI review. Later, teammates.

- **AI review runs locally**, before the PR is opened: `/code-review` in Claude Code on the branch. Findings are fixed as `fix(review)` commits, and a short summary (what was found, what was fixed, what was skipped and why) goes into the PR description under **Review**.
- No GitHub Action for AI review for now — it would need a token and app setup, and running it live teaches more. A GitHub-side reviewer can be added later (Claude's GitHub Action) if the repo needs one; the earlier version is in git history (commit `ffd14e2`).

Comments use **Conventional Comments** labels so the author knows what's required:

| Label | Meaning | Must the author act? |
|---|---|---|
| `blocking:` | Bug, broken rule, missing test | Yes, before merge |
| `issue:` | A real problem, fix may be discussed | Yes — fix or agree on a follow-up ticket |
| `suggestion:` | A better way | Author decides, says why |
| `question:` | Reviewer doesn't understand | Answer (and often: improve the code/comment so the next reader doesn't ask) |
| `nit:` | Tiny style point | Optional |
| `praise:` | Something done well | No — but keep doing it |

Example: `blocking: removeNode leaves edges pointing at the deleted node — add a test with 2 attached edges.`

## 6. Fix the comments

1. Go through **every** thread. For each one, either:
   - fix it in a commit (`fix(review): M1-05 drop dangling edges in removeNode`) and reply *"Fixed in <short sha>"*, or
   - reply why not (with a reason, not "I prefer"), or
   - create a follow-up ticket and link it.
2. **No force-push during review** — new commits keep the history readable for the reviewer. Squash happens at merge.
3. Resolve a thread only when the fix is pushed (solo: you resolve; with teammates: the reviewer resolves).
4. Push → CI runs again → re-request review if someone else reviewed.
5. Learning-log line: what did the review catch that you missed? Patterns repeating across PRs become new rules or lint checks.

> Using Claude to fix comments: fine — but for learning, read each fix and be able to explain it. Ask "why" before accepting.

## 7. Merge

- Squash merge when: CI green, every thread answered, acceptance criteria ticked.
- Delete the branch. Set the ticket to `done`.

## 8. Repository settings (one-time, on GitHub)

- Branch protection on `main`: require a pull request; require status checks `checks`, `unit`, `security`, `codeql`, `e2e`; block force-push; require branches to be up to date.
- Code security: Dependabot alerts + Dependabot security updates on; secret scanning + push protection on (already enabled).
- Approvals: GitHub doesn't count approving your own PR, so while solo, rely on required checks + the self/AI review above.
- Merge button: allow **squash merge** only; auto-delete head branches.
