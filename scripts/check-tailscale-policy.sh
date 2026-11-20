#!/usr/bin/env bash
#
# scripts/check-tailscale-policy.sh
#
# Guard that the tailnet policy covers every Tailscale Service a host declares.
#
# A host exposes a Service by declaring it in my.stacks.vpn.services; the flake
# gathers those declarations, with each host's tags, into `tailscaleServices`.
# The Service only works once configs/tailscale/policy.hujson also has
#
#   - a grant whose `dst` names it, so members may reach it (the wildcard
#     grant does not count: it is kept only until the tightening pass in
#     docs/tailscale.md removes it), and
#   - an `autoApprovers.services` entry listing one of its host's tags, so the
#     host's advertisement is approved without the admin console.
#
#   check        Evaluate the flake's tailscaleServices and the policy; exit 1
#                naming every Service the policy does not cover.
#
# Exit codes: 0 clean, 1 violation, 2 usage or tool error.
#
# Env:
#   TAILSCALE_POLICY_ROOT      Repo root to check (default: git toplevel, else
#                              the script's parent directory).
#   TAILSCALE_SERVICES_JSON    A file holding the tailscaleServices JSON to
#                              check instead of evaluating the flake.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: check-tailscale-policy.sh check

  check  Fail when a declared Tailscale Service lacks a policy grant or a
         Service auto-approver for one of its host's tags.
EOF
}

resolve_root() {
  if [ -n "${TAILSCALE_POLICY_ROOT:-}" ]; then
    ROOT_DIR="$(cd "$TAILSCALE_POLICY_ROOT" && pwd)"
  else
    ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -z "$ROOT_DIR" ]; then
      ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    fi
  fi
  POLICY="$ROOT_DIR/configs/tailscale/policy.hujson"
}

require() {
  local tool
  for tool in "$@"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "error: $tool not found; run inside the dev shell (nix develop)" >&2
      exit 2
    fi
  done
}

# The declared Services as JSON. A git checkout is evaluated as one, so only
# tracked files count; anything else (the gate's index snapshot) as a path.
declared_services() {
  if [ -n "${TAILSCALE_SERVICES_JSON:-}" ]; then
    command cat "$TAILSCALE_SERVICES_JSON"
  elif [ -e "$ROOT_DIR/.git" ]; then
    nix eval --json "$ROOT_DIR#tailscaleServices"
  else
    nix eval --json "path:$ROOT_DIR#tailscaleServices"
  fi
}

check() {
  require jq hujsonfmt
  [ -f "$POLICY" ] || {
    echo "error: policy not found: $POLICY" >&2
    exit 2
  }

  local policy_json services_json violations line
  # HuJSON (comments, trailing commas) standardized to plain JSON.
  policy_json="$(hujsonfmt -s "$POLICY")"
  services_json="$(declared_services)"

  violations="$(
    jq -rn --argjson policy "$policy_json" --argjson services "$services_json" '
      ($policy.grants // [] | map(.dst // []) | add // []) as $granted
      | ($policy.autoApprovers.services // {}) as $approvers
      | $services[]
      | . as $s
      | (if ($granted | index($s.name)) == null then
           "\($s.name) (declared by \($s.host)): no grant has it in dst"
         else empty end),
        (($approvers[$s.name] // []) as $approved
         | if ($s.tags | any(. as $t | $approved | index($t) != null)) then empty
           elif ($s.tags | length) == 0 then
             "\($s.name) (declared by \($s.host)): the host records no tags in my.stacks.vpn.tags, so no auto-approver can match it"
           else
             "\($s.name) (declared by \($s.host), tags \($s.tags | join(", "))): autoApprovers.services lists none of those tags"
           end)
    ' | sort -u
  )"

  if [ -n "$violations" ]; then
    echo "error: configs/tailscale/policy.hujson does not cover every declared Tailscale Service:" >&2
    while IFS= read -r line; do
      echo "  $line" >&2
    done <<<"$violations"
    echo "Add the grant and the autoApprovers.services entry, or drop the Service from its host." >&2
    exit 1
  fi
  echo "ok: the policy grants and auto-approves all $(jq 'map(.name) | unique | length' <<<"$services_json") declared Tailscale Services"
}

case "${1:-}" in
  check)
    resolve_root
    check
    ;;
  -h | --help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
