#!/usr/bin/env bash
# Shim: routes Claude Code hook events into intent/gate.sh (the single
# admission gate). No logic here beyond translating gate output to hook JSON.
# Registered in intent/SURFACES.md.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
event="${1:-session}"

status=0
out="$("$ROOT/intent/gate.sh" session claude-code 2>&1)" || status=$?
hard="$(printf '%s\n' "$out" | sed -n 's/^HARD_MISSING: //p')"
soft="$(printf '%s\n' "$out" | sed -n 's/^SOFT_MISSING: //p')"

reason="missing required tools ($hard)"
# Gate crashed rather than reporting missing tools — surface the raw error.
[ "$status" -ne 0 ] && [ -z "$hard" ] && reason="gate error ($out)"

if [ "$event" = "pretool" ]; then
  [ "$status" -eq 0 ] && exit 0
  jq -cn --arg r "Gate: $reason. Restore env first (rebuild, or nix develop) before editing this repo." \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
fi

[ -z "$hard" ] && [ -z "$soft" ] && exit 0
msg=""
[ -n "$hard" ] && msg="GATE FAILED: missing required tools ($hard). Editing is blocked until restored — run rebuild or nix develop. "
[ -n "$soft" ] && msg="${msg}Missing devShell tools ($soft): run repo shell/CI tasks through nix develop --command <cmd>."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"},"systemMessage":"dotfiles gate: %s"}\n' "$msg" "$msg"
