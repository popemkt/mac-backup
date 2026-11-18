#!/usr/bin/env bash
# Exercise the common check/update contract through both production entry points.
set -euo pipefail

github=$1
uv=$2
python_dir=$3
python_fixture=$4
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

run_case() {
  local adapter="$1" case_name="$2" expected="$3" newest="$4" status=0
  shift 4
  local root="$work/$adapter-$case_name" app pin
  mkdir -p "$root/_sources" "$root/home" "$root/record"
  git -C "$root" init -q
  cat >"$root/nvfetcher.toml" <<'TOML'
[held]
src.github_tag = "example/held"
src.include_regex = '^v[0-9]+\.[0-9]+\.[0-9]+$'
fetch.url = "https://example.invalid/v$ver/held.tar.gz"
TOML
  printf '{"held":{"version":"1.0.0","src":{"url":"https://example.invalid/v1.0.0/held.tar.gz"}}}\n' \
    >"$root/_sources/generated.json"
  printf '{"held":{"version":"1.0.0","track":"latest"}}\n' >"$root/_sources/uv-pins.json"
  if [ "$adapter" = github ]; then
    app=("$github")
    pin="$root/_sources/generated.json"
  else
    app=("$BASH" "$uv")
    pin="$root/_sources/uv-pins.json"
  fi

  cp "$pin" "$root/original"
  env -i HOME="$root/home" PATH="$python_dir:$PATH" \
    GITHUB_SOURCES_ROOT="$root" UV_SOURCES_ROOT="$root" \
    STUB_RECORD="$root/record" STUB_PRIMARY="$newest" STUB_PROBE="$newest" \
    PYTHONPATH="$python_fixture" "${app[@]}" "$@" >"$root/stdout" 2>"$root/stderr" || status=$?
  if [ "$status" -ne "$expected" ]; then
    echo "$adapter/$case_name: expected exit $expected, got $status" >&2
    cat "$root/stdout" "$root/stderr" >&2
    return 1
  fi
  if [ "$case_name" = update ]; then
    [ "$(jq -r '.held.version' "$pin")" = "$newest" ]
  else
    cmp "$root/original" "$pin"
  fi
  case "$case_name" in
    current) grep -qi 'pins are current' "$root/stdout" ;;
    unavailable|best-effort) grep -qi 'warning:' "$root/stderr" ;;
  esac
}

for adapter in github uv; do
  run_case "$adapter" current 0 1.0.0 check
  run_case "$adapter" outdated 10 1.1.0 check
  run_case "$adapter" unavailable 20 "" check
  run_case "$adapter" best-effort 0 "" check --best-effort
  run_case "$adapter" update 0 1.1.0 update
  run_case "$adapter" update-unavailable 20 "" update
done
