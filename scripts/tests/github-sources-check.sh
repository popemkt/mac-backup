#!/usr/bin/env bash
# Fixture test for `github-sources check`: how the freshness run and the hold
# probe combine into a verdict. nvfetcher is replaced by a stub that answers
# from fixtures, so the test is offline and deterministic.
#
# Usage: github-sources-check.sh <path to scripts/github-sources>
# Needs bash, jq, and remarshal on PATH (the flake check provides them).

set -euo pipefail

script="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The stub resolves the real configuration (it declares include_regex) from
# STUB_PRIMARY and the hold probe (it does not) from STUB_PROBE. An empty
# answer is a failed resolution: no generated.json entry, like nvfetcher's
# --keep-going when a source fails.
mkdir -p "$work/bin"
# The stub names bash by absolute path: a build sandbox has no /usr/bin/env.
printf '#!%s\n' "$(command -v bash)" >"$work/bin/nvfetcher"
cat >>"$work/bin/nvfetcher" <<'STUB'
set -euo pipefail
config="" build_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config) config="$2"; shift 2 ;;
    --build-dir) build_dir="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$build_dir"
if grep -q include_regex "$config"; then
  answer="${STUB_PRIMARY:-}"
else
  cp "$config" "$STUB_RECORD/probe.toml"
  answer="${STUB_PROBE:-}"
fi
if [ -z "$answer" ]; then
  echo "stub: resolution failed" >&2
  echo '{}' >"$build_dir/generated.json"
  exit 1
fi
printf '{"held": {"version": "%s"}}\n' "$answer" >"$build_dir/generated.json"
STUB
chmod +x "$work/bin/nvfetcher"
export PATH="$work/bin:$PATH"

failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

# run_case <name> <pin> <primary> <probe> <expected rc> [check args...]
run_case() {
  local name="$1" pin="$2" primary="$3" probe="$4" want_rc="$5"
  shift 5
  local root="$work/$name" rc
  mkdir -p "$root/_sources" "$root/record"
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

  set +e
  GITHUB_SOURCES_ROOT="$root" STUB_RECORD="$root/record" \
    STUB_PRIMARY="$primary" STUB_PROBE="$probe" \
    bash "$script" check "$@" >"$root/stdout" 2>"$root/stderr"
  rc=$?
  set -e
  [ "$rc" -eq "$want_rc" ] || fail "$name: exit $rc, want $want_rc"
  echo "case $name: exit $rc"
}

expect_line() {
  local name="$1" stream="$2" pattern="$3"
  grep -qE -- "$pattern" "$work/$name/$stream" \
    || fail "$name: $stream lacks /$pattern/: $(cat "$work/$name/$stream")"
}

# A failed hold probe must not hide a real update.
run_case outdated-unprobed 5.3.6 5.3.7 "" 10
expect_line outdated-unprobed stdout '^held: 5\.3\.6 -> 5\.3\.7$'
expect_line outdated-unprobed stderr '^warning: held: could not resolve its newest unfiltered release'
expect_line outdated-unprobed stderr 'stub: resolution failed'

run_case outdated-unprobed-best-effort 5.3.6 5.3.7 "" 10 --best-effort
expect_line outdated-unprobed-best-effort stdout '^held: 5\.3\.6 -> 5\.3\.7$'

# A current pin stays current, with the unknown hold said out loud.
run_case current-unprobed 5.3.7 5.3.7 "" 0
expect_line current-unprobed stderr '^warning: held: could not resolve its newest unfiltered release'
expect_line current-unprobed stdout '1 hold unprobed'

# A resolved probe names the release the filter excludes.
run_case current-excluded 5.3.7 5.3.7 5.4.0-beta.1 0
expect_line current-excluded stdout '^held: newer release 5\.4\.0-beta\.1 excluded by its list filters$'
expect_line current-excluded stdout '1 with a newer release excluded'

# The probe fetches the committed artifact, never the excluded release.
expect_line current-excluded record/probe.toml '^url = "https://example\.invalid/v5\.3\.7/held\.tar\.gz"$'
if grep -q include_regex "$work/current-excluded/record/probe.toml"; then
  fail "current-excluded: probe config kept its list filter"
fi

# Only the freshness run makes a source unavailable.
run_case primary-failed 5.3.7 "" 5.4.0-beta.1 20
expect_line primary-failed stderr '^warning: skipped held; nvfetcher could not resolve its upstream'
run_case primary-failed-best-effort 5.3.7 "" 5.4.0-beta.1 0 --best-effort

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)" >&2
  exit 1
fi
echo "github-sources check: all cases pass"
