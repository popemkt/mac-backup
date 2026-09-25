# shellcheck shell=bash
# nvfetcher stand-in for github-sources-check.sh, answering from fixtures.
# Built into the app under test in place of the real nvfetcher (flake.nix).
# It tells the three configurations github-sources writes apart by content:
#   verify's pinned config (src.manual)  -> copies $STUB_GENERATED/generated.*
#   check's real config (include_regex)   -> version $STUB_PRIMARY
#   check's hold probe (neither)          -> version $STUB_PROBE
# An empty answer is a failed resolution: nothing generated, exit 1.
set -euo pipefail

config="" build_dir=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      config="$2"
      shift 2
      ;;
    --build-dir)
      build_dir="$2"
      shift 2
      ;;
    *) shift ;;
  esac
done
mkdir -p "$build_dir"
text="$(<"$config")"

fail() {
  echo "stub: resolution failed" >&2
  exit 1
}

if [[ "$text" == *manual* ]]; then
  [ -n "${STUB_GENERATED:-}" ] || fail
  cp "$STUB_GENERATED/generated.json" "$STUB_GENERATED/generated.nix" "$build_dir/"
  exit 0
fi

if [[ "$text" == *include_regex* ]]; then
  answer="${STUB_PRIMARY:-}"
else
  cp "$config" "$STUB_RECORD/probe.toml"
  answer="${STUB_PROBE:-}"
fi
[ -n "$answer" ] || fail
printf '{"held": {"version": "%s"}}\n' "$answer" >"$build_dir/generated.json"
