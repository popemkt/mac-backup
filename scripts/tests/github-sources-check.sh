#!/usr/bin/env bash
# Fixture test for the github-sources app: how check's freshness run and hold
# probe combine into a verdict, and how verify answers. The app under test is
# the flake's own wrapper built with scripts/tests/nvfetcher-stub.sh in place
# of nvfetcher, so the test is offline and deterministic.
#
# Every case runs the app the way CI does: `env -i`, an empty HOME, no
# TMPDIR, and PATH=/usr/bin:/bin, so nothing from the caller's environment
# (a newer bash, a token, a temp dir) can make it pass.
#
# Usage: github-sources-check.sh <path to the app's bin/github-sources>

set -euo pipefail

app="$1"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

# fixture <name> <pin>: a repo root with one filtered source pinned at <pin>,
# plus the generated files a consistent regeneration would produce.
fixture() {
  local root="$work/$1" pin="$2"
  mkdir -p "$root/_sources" "$root/record" "$root/home" "$root/regenerated"
  cat >"$root/nvfetcher.toml" <<'TOML'
[held]
src.github_tag = "example/held"
src.include_regex = '^v[0-9]+\.[0-9]+\.[0-9]+$'
src.from_pattern = "^v(.+)$"
src.to_pattern = "\\1"
fetch.url = "https://example.invalid/v$ver/held.tar.gz"
TOML
  printf '{"held": {"version": "%s", "src": {"url": "https://example.invalid/v%s/held.tar.gz"}}}\n' \
    "$pin" "$pin" >"$root/_sources/generated.json"
  printf '{ held = { version = "%s"; }; }\n' "$pin" >"$root/_sources/generated.nix"
  cp "$root/_sources/generated.json" "$root/_sources/generated.nix" "$root/regenerated/"
}

# run <name> <expected status> <stub env...> -- <app args...>
run() {
  local name="$1" want="$2" root="$work/$1" status
  shift 2
  local stub_env=()
  while [ "$1" != "--" ]; do
    stub_env+=("$1")
    shift
  done
  shift
  set +e
  env -i \
    HOME="$root/home" \
    PATH=/usr/bin:/bin \
    GITHUB_SOURCES_ROOT="$root" \
    STUB_RECORD="$root/record" \
    "${stub_env[@]}" \
    "$app" "$@" >"$root/stdout" 2>"$root/stderr"
  status=$?
  set -e
  [ "$status" -eq "$want" ] || fail "$name: exit $status, want $want: $(cat "$root/stderr")"
  echo "case $name: exit $status"
}

expect() {
  local name="$1" stream="$2" pattern="$3"
  grep -qE -- "$pattern" "$work/$name/$stream" \
    || fail "$name: $stream lacks /$pattern/: $(cat "$work/$name/$stream")"
}

# --- check -----------------------------------------------------------------

# A failed hold probe must not hide a real update.
fixture outdated-unprobed 5.3.6
run outdated-unprobed 10 STUB_PRIMARY=5.3.7 -- check
expect outdated-unprobed stdout '^held: 5\.3\.6 -> 5\.3\.7$'
expect outdated-unprobed stderr '^warning: held: could not resolve its newest unfiltered release'
expect outdated-unprobed stderr 'stub: resolution failed'

fixture outdated-unprobed-best-effort 5.3.6
run outdated-unprobed-best-effort 10 STUB_PRIMARY=5.3.7 -- check --best-effort
expect outdated-unprobed-best-effort stdout '^held: 5\.3\.6 -> 5\.3\.7$'

# A current pin stays current, with the unknown hold said out loud.
fixture current-unprobed 5.3.7
run current-unprobed 0 STUB_PRIMARY=5.3.7 -- check
expect current-unprobed stderr '^warning: held: could not resolve its newest unfiltered release'
expect current-unprobed stdout '1 hold unprobed'

# A resolved probe names the release the filter excludes, and fetches the
# committed artifact rather than the excluded release.
fixture current-excluded 5.3.7
run current-excluded 0 STUB_PRIMARY=5.3.7 STUB_PROBE=5.4.0-beta.1 -- check
expect current-excluded stdout '^held: newer release 5\.4\.0-beta\.1 excluded by its list filters$'
expect current-excluded stdout '1 with a newer release excluded'
expect current-excluded record/probe.toml '^url = "https://example\.invalid/v5\.3\.7/held\.tar\.gz"$'
if grep -q include_regex "$work/current-excluded/record/probe.toml"; then
  fail "current-excluded: probe config kept its list filter"
fi

# Only the freshness run makes a source unavailable.
fixture primary-failed 5.3.7
run primary-failed 20 STUB_PROBE=5.4.0-beta.1 -- check
expect primary-failed stderr '^warning: skipped held; nvfetcher could not resolve its upstream'
fixture primary-failed-best-effort 5.3.7
run primary-failed-best-effort 0 STUB_PROBE=5.4.0-beta.1 -- check --best-effort

# --- verify ----------------------------------------------------------------

# No GITHUB_TOKEN here, as in CI: the empty credentials array must not kill
# the run (it did under bash 3.2, silently).
fixture verify-consistent 5.3.7
run verify-consistent 0 STUB_GENERATED="$work/verify-consistent/regenerated" -- verify
expect verify-consistent stdout '^Generated release sources match nvfetcher.toml at their pinned versions\.$'

fixture verify-mismatch 5.3.7
printf '{ held = { version = "5.3.7"; hash = "other"; }; }\n' \
  >"$work/verify-mismatch/regenerated/generated.nix"
run verify-mismatch 11 STUB_GENERATED="$work/verify-mismatch/regenerated" -- verify
expect verify-mismatch stderr '^error: _sources/generated\.nix does not match nvfetcher\.toml at the pinned versions$'

# A failed regeneration is reported with nvfetcher's own output.
fixture verify-failed 5.3.7
run verify-failed 20 -- verify
expect verify-failed stderr 'stub: resolution failed'
expect verify-failed stderr '^error: nvfetcher could not regenerate release sources at their pinned versions$'

# --best-effort passes only because the pinned artifact's host is unreachable.
fixture verify-failed-best-effort 5.3.7
run verify-failed-best-effort 0 -- verify --best-effort
expect verify-failed-best-effort stderr '^warning: could not fetch pinned release artifacts while offline; continuing$'

# --- no silent exits --------------------------------------------------------

# A failure outside the documented statuses still says something: update
# succeeds, then its `git diff --stat` fails because the root is no repo.
fixture unexpected 5.3.7
run unexpected 129 STUB_PRIMARY=5.3.7 -- update
expect unexpected stderr '^error: github-sources exited unexpectedly \(status 129\)$'

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)" >&2
  exit 1
fi
echo "github-sources: all cases pass"
