#!/usr/bin/env bash
# Red-count for a set of ui test files, run N times.
#
# Evidence for gap [[01M1XA98A0A7PWEPMHG2T4R5GP]]: a suite that reddens under
# load needs a count, not an anecdote. Run the suspect file alone, then paired
# with its neighbour, then paired with `--no-file-parallelism`. If the pair is
# red and the solo run is green, load is the trigger; if the *sequential* pair
# is red too, file parallelism is not the mechanism.
#
#   src/test-support/pairing-counts.sh 10 \
#     src/components/outline/use-node-keydown.characterization.test.tsx \
#     src/components/outline/editor-behavior.test.tsx
#
# Run from packages/app/ui. Logs land in a temp dir the script prints.
set -u

runs="${1:?usage: pairing-counts.sh <runs> <test file>...}"
shift
[ "$#" -gt 0 ] || { echo "usage: pairing-counts.sh <runs> <test file>..." >&2; exit 2; }

logs="$(mktemp -d "${TMPDIR:-/tmp}/kb-pairing-XXXXXX")"
echo "logs: $logs"

count_reds() {
  local tag="$1"; shift
  local red=0
  for i in $(seq 1 "$runs"); do
    bunx vp test "$@" >"$logs/$tag-$i.log" 2>&1 || red=$((red + 1))
  done
  echo "$tag: $red/$runs red"
  grep -h "^ FAIL " "$logs/$tag-"*.log 2>/dev/null | sort | uniq -c | sed 's/^/    /'
}

for file in "$@"; do
  count_reds "solo-$(basename "$file" | cut -d. -f1)" "$file"
done
count_reds parallel "$@"
count_reds sequential "$@" --no-file-parallelism
