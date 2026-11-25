#!/usr/bin/env bash
# A `gh` that answers `gh api repos/<repo>/actions/runs?head_sha=<sha>...`
# from $STUB_RUNS/<sha>.json (a list of runs; none when absent), and first
# runs $STUB_RUNS/<sha>.hook when there is one (to move a branch mid-run).
set -eu

if [ "$1" != api ]; then
  echo "stub: unexpected gh command: $*" >&2
  exit 2
fi
case "$2" in
  repos/example/dotfiles/actions/runs\?head_sha=*) ;;
  *)
    echo "stub: unexpected gh api path: $2" >&2
    exit 2
    ;;
esac
sha="${2#*head_sha=}"
sha="${sha%%&*}"
if [ -x "$STUB_RUNS/$sha.hook" ]; then
  "$STUB_RUNS/$sha.hook"
fi
if [ -f "$STUB_RUNS/$sha.json" ]; then
  jq '{total_count: length, workflow_runs: .}' "$STUB_RUNS/$sha.json"
else
  echo '{"total_count": 0, "workflow_runs": []}'
fi
