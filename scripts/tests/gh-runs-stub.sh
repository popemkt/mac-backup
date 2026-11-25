#!/usr/bin/env bash
# A `gh` that answers `gh api repos/<repo>/actions/runs?head_sha=<sha>...`
# from $STUB_RUNS/<sha>.json (a list of runs; none when absent), and first
# runs $STUB_RUNS/<sha>.hook when there is one (to move a branch mid-run).
# With $STUB_RUNS/<sha>.fail it fails, as the API does when it is down.
# Also answers a run's jobs (.../runs/<id>/jobs; fails with $STUB_RUNS/jobs.fail)
# and a workflow's runs (.../workflows/<file>/runs; $STUB_RUNS/workflow.fail).
set -eu

if [ "$1" != api ]; then
  echo "stub: unexpected gh command: $*" >&2
  exit 2
fi
case "$2" in
  repos/example/dotfiles/actions/runs\?head_sha=*) ;;
  repos/example/dotfiles/actions/workflows/*/runs*)
    # Every run of one workflow, from all the fixtures.
    workflow="${2#repos/example/dotfiles/actions/workflows/}"
    workflow="${workflow%%/*}"
    if [ -e "$STUB_RUNS/workflow.fail" ]; then
      echo "gh: HTTP 502: Server Error" >&2
      exit 1
    fi
    for file in "$STUB_RUNS"/*.json; do
      [ -e "$file" ] || continue
      jq --arg w ".github/workflows/$workflow" '.[] | select(.path == $w)' "$file"
    done | jq -s '{total_count: length, workflow_runs: .}'
    exit 0
    ;;
  repos/example/dotfiles/actions/runs/*/jobs*)
    # A run's jobs: its `applied <sha>` job, naming the run's `applied`
    # (its trigger commit unless the fixture says otherwise).
    id="${2#repos/example/dotfiles/actions/runs/}"
    id="${id%%/*}"
    if [ -e "$STUB_RUNS/jobs.fail" ]; then
      echo "gh: HTTP 502: Server Error" >&2
      exit 1
    fi
    for file in "$STUB_RUNS"/*.json; do
      jq --argjson id "$id" --arg sha "$(basename "$file" .json)" '
        .[] | select(.id == $id)
        | {jobs: [{name: "applied \(.applied // $sha)", conclusion}]}' "$file"
    done | jq -s 'first // {jobs: []}'
    exit 0
    ;;
  *)
    echo "stub: unexpected gh api path: $2" >&2
    exit 2
    ;;
esac
sha="${2#*head_sha=}"
sha="${sha%%&*}"
if [ -e "$STUB_RUNS/$sha.fail" ]; then
  echo "gh: HTTP 502: Server Error" >&2
  exit 1
fi
if [ -x "$STUB_RUNS/$sha.hook" ]; then
  "$STUB_RUNS/$sha.hook"
fi
if [ -f "$STUB_RUNS/$sha.json" ]; then
  jq '{total_count: length, workflow_runs: .}' "$STUB_RUNS/$sha.json"
else
  echo '{"total_count": 0, "workflow_runs": []}'
fi
