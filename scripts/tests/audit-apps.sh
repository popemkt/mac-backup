#!/usr/bin/env bash
#
# Offline test of the drift audit's /Applications report
# (scripts/lib/audit-apps.sh): it renders only from probes that were read.
# Usage: audit-apps.sh <path to lib/audit-probes.sh> <path to lib/audit-apps.sh>

set -euo pipefail

# shellcheck source=SCRIPTDIR/../lib/audit-probes.sh
. "$1"
# shellcheck source=SCRIPTDIR/../lib/audit-apps.sh
. "$2"

BREW_BIN=/nonexistent/brew
WARNINGS=()
record_warn() { WARNINGS+=("$1"); }
warn_detail() { :; }
print_section() { printf '== %s ==\n' "$1"; }
print_list() {
  local item
  for item in "$@"; do printf '  - %s\n' "$item"; done
}
array_contains() {
  local needle="$1" item
  shift
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

failures=0
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  failures=$((failures + 1))
}

# Run the report in this shell, so its warnings are recorded, and keep what
# it printed in $out.
out=
render() {
  report_app_drift "$@" >"$AUDIT_PROBE_DIR/report"
  out="$(cat "$AUDIT_PROBE_DIR/report")"
}

two_apps() { printf '%s\n' /Applications/One.app /Applications/Two.app; }
crashed_listing() {
  printf 'Error: brew crashed\n' >&2
  return 1
}
empty_listing() { :; }

apps_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start two_apps
crashed_casks_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start crashed_listing
crashed_apps_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start crashed_listing
empty_casks_probe=${#AUDIT_PROBE_PIDS[@]}
audit_probe_start empty_listing
audit_probe_wait_all

# A failed cask list must not class every app as manual or App Store.
render "$apps_probe" "$crashed_casks_probe"
[ -z "$out" ] || fail "failed cask list still rendered: $out"
[ "${#WARNINGS[@]}" -eq 1 ] || fail "failed cask list did not warn exactly once"
case "${WARNINGS[0]:-}" in
  "brew list --cask failed"*) ;;
  *) fail "failed cask list warning names the wrong probe: ${WARNINGS[0]:-none}" ;;
esac

# A failed /Applications scan must not publish "0 bundles found".
WARNINGS=()
render "$crashed_apps_probe" "$empty_casks_probe"
[ -z "$out" ] || fail "failed /Applications scan still rendered: $out"
[ "${#WARNINGS[@]}" -eq 1 ] || fail "failed /Applications scan did not warn exactly once"

# A read, empty cask list is real: every app is unmanaged.
WARNINGS=()
render "$apps_probe" "$empty_casks_probe"
printf '%s\n' "$out" | grep -qx '  Total .app bundles found: 2' || fail "empty cask list: wrong total"
printf '%s\n' "$out" | grep -qx '  Unmanaged (internet/manual): 2' || fail "empty cask list: wrong unmanaged count"
[ "${#WARNINGS[@]}" -eq 0 ] || fail "empty cask list warned: ${WARNINGS[*]}"

# Without Homebrew there is no cask probe, and no app is a cask.
render "$apps_probe" ""
printf '%s\n' "$out" | grep -qx '  Brew cask managed: 0' || fail "no Homebrew: report did not render"
[ "${#WARNINGS[@]}" -eq 0 ] || fail "no Homebrew warned: ${WARNINGS[*]}"

if [ "$failures" -ne 0 ]; then
  printf '%s audit-apps case(s) failed\n' "$failures" >&2
  exit 1
fi
printf 'audit apps: all cases passed\n'
