#!/usr/bin/env bash
# PR size guardrail (ADR-014, general.md "small PRs"): at most MAX changed lines of code between
# BASE and HEAD. Not counted: the lockfile, recorded fixtures, snapshots, docs and tickets (prose and
# saved boards), and generated JSON. The owner's `large-ok` label lets one PR through, on purpose.
#   BASE_SHA=… HEAD_SHA=… LARGE_OK=false bash .github/scripts/pr-size.sh
set -euo pipefail
MAX=${MAX:-400}

changed=$(git diff --numstat "$BASE_SHA...$HEAD_SHA" -- \
  apps packages tooling scripts infra .github \
  ':(exclude)pnpm-lock.yaml' ':(exclude)**/fixtures/**' ':(exclude)**/*.snap' \
  ':(exclude)**/*.sse' ':(exclude)**/*.json' |
  awk '$1 != "-" { total += $1 + $2 } END { print total + 0 }')

echo "Changed lines of code: $changed (limit $MAX)."
if [ "$changed" -le "$MAX" ]; then exit 0; fi
if [ "${LARGE_OK:-false}" = "true" ]; then
  echo "Over the limit, but labelled large-ok by the owner: allowed."
  exit 0
fi
echo "::error::This PR changes $changed lines of code (limit $MAX). Split the ticket, or have the owner add the large-ok label."
exit 1
