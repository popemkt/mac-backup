#!/usr/bin/env bash
#
# Offline test of the drift audit's probe mechanism (scripts/lib/audit-probes.sh):
# when read_probe_into loads a listing and when it reports the probe as failed.
# Usage: audit-probes.sh <path to lib/audit-probes.sh>

set -euo pipefail

# shellcheck source=SCRIPTDIR/../lib/audit-probes.sh
. "$1"

WARNINGS=()
record_warn() { WARNINGS+=("$1"); }
warn_detail() { :; }

failures=0
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

# npm ls -g --parseable prints the whole tree, then exits 1 (ELSPROBLEMS) when
# a declared global is missing or invalid.
npm_tree_then_exit_1() {
  printf '%s\n' /prefix/lib /prefix/lib/node_modules/a /prefix/lib/node_modules/b
  printf 'npm error code ELSPROBLEMS\n' >&2
  return 1
}
crashed_listing() {
  printf 'boom\n' >&2
  return 3
}
empty_listing() { :; }

tree_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start npm_tree_then_exit_1
crash_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start crashed_listing
empty_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start empty_listing
audit_probe_wait_all

tree=()
if read_probe_into tree "$tree_probe" "npm ls -g"; then
  [ "${#tree[@]}" -eq 3 ] || fail "non-zero probe with output: expected 3 lines, got ${#tree[@]}"
  [ "${tree[2]:-}" = /prefix/lib/node_modules/b ] || fail "non-zero probe with output: wrong lines"
else
  fail "non-zero probe with output was read as failed"
fi
[ "${#WARNINGS[@]}" -eq 0 ] || fail "non-zero probe with output warned: ${WARNINGS[*]}"

crashed=(stale)
if read_probe_into crashed "$crash_probe" "brew leaves"; then
  fail "failed probe with no output was read as an inventory"
fi
[ "${#crashed[@]}" -eq 0 ] || fail "failed probe left stale lines"
[ "${#WARNINGS[@]}" -eq 1 ] || fail "failed probe did not warn exactly once"
case "${WARNINGS[0]:-}" in
  "brew leaves failed (exit 3)"*) ;;
  *) fail "failed probe warning names the wrong probe: ${WARNINGS[0]:-none}" ;;
esac

empty=(stale)
if read_probe_into empty "$empty_probe" "brew outdated"; then
  [ "${#empty[@]}" -eq 0 ] || fail "successful empty probe kept stale lines"
else
  fail "successful empty probe was read as failed"
fi
[ "${#WARNINGS[@]}" -eq 1 ] || fail "successful empty probe warned"

if [ "$failures" -ne 0 ]; then
  printf '%s audit-probe case(s) failed\n' "$failures" >&2
  exit 1
fi
printf 'audit probes: all cases passed\n'
