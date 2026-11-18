# mcp-servers-sync: register the MCP servers the host's stacks declare
# (my.pkgs.mcpServers) with every agent harness this account has. ./default.nix
# prepends: home, servers (a JSON file: {name: {command, args, env}}), state
# (this sync's state directory), cu (coreutils' bin), flock and jq by absolute
# path, and warn and lock_state (../plugin-sources/sync-lib.sh). claude and
# codex come from PATH, which ./default.nix sets: Homebrew, npm or their own
# installers own them, not Nix.
#
# Each harness gets each server in its own shape, under the server's name:
#
# - Claude Code, user scope: `claude mcp add-json --scope user`, read back
#   from ~/.claude.json, which Claude Code rewrites itself, so it is only read.
# - Codex: `codex mcp add`, read back from `codex mcp list --json`.
# - Cursor (~/.cursor/mcp.json), Gemini CLI (~/.gemini/settings.json), Oh My
#   Pi (~/.omp/agent/mcp.json) and opencode (~/.config/opencode/opencode.json):
#   the file, edited with jq, only where the harness's own folder exists.
#
# A server already registered as declared is left alone; one registered
# differently is replaced. A name this sync registered before and no stack
# declares any more ($state/managed) is removed, since its command is a store
# path that garbage collection will take. A server a person registered under
# another name is never touched.
#
# `mcp-servers-sync --check` changes nothing and prints one line per declared
# server a harness lacks or has differently ("<harness>: <name>"), which the
# drift audit (scripts/audit-system-discrepancies.sh) counts.
#
# Best effort, like every executor: a harness whose CLI is missing or whose
# listing fails is skipped with a warning (a failed listing is never read as
# "nothing registered"), a file that is not plain JSON (opencode allows
# comments) is left alone, and the script always exits 0.

check=false
case "${1:-}" in
  "") ;;
  --check) check=true ;;
  *)
    echo "usage: mcp-servers-sync [--check]" >&2
    exit 2
    ;;
esac

if ! $check; then
  lock_state "$state" "registering MCP servers with the agents" || exit 0
fi

declared="$("$jq" -c 'map_values({command, args: (.args // []), env: (.env // {})})' "$servers")" || {
  warn "cannot read the declared MCP servers ($servers)"
  exit 0
}
names="$(printf '%s' "$declared" | "$jq" -r 'keys[]')"
previous=""
[ -f "$state/managed" ] && previous="$("$cu/cat" "$state/managed")"
# Names this sync registered before that no stack declares now, as JSON.
dropped="$(printf '%s\n' "$previous" | "$jq" -R -s -c --argjson d "$declared" \
  'split("\n") | map(select(. as $n | $n != "" and ($d | has($n) | not)))')" || {
  warn "cannot read $state/managed; removed no MCP server this sync registered before"
  dropped='[]'
}

# Nothing declared and nothing to take back: no harness is asked anything.
[ -z "$names" ] && [ "$dropped" = "[]" ] && exit 0

# --check's report: one line per server a harness lacks or has differently.
missing() { printf '%s: %s\n' "$1" "$2"; }

# ---- Claude Code (user scope) -----------------------------------------------
claude_sync() {
  if ! command -v claude >/dev/null 2>&1; then
    $check || warn "claude is unavailable; skipped its MCP servers"
    return 0
  fi
  local config="$home/.claude.json" registered='{}'
  if [ -s "$config" ]; then
    if ! registered="$("$jq" -c '.mcpServers // {}' "$config" 2>/dev/null)"; then
      warn "cannot read $config; skipped Claude Code's MCP servers"
      return 0
    fi
  fi
  local name want have
  for name in $names; do
    want="$(printf '%s' "$declared" | "$jq" -c --arg n "$name" '.[$n] | {type: "stdio", command, args, env}')"
    have="$(printf '%s' "$registered" | "$jq" -c --arg n "$name" \
      '.[$n] // empty | {type: (.type // "stdio"), command, args: (.args // []), env: (.env // {})}')"
    [ "$have" = "$want" ] && continue
    if $check; then
      missing "Claude Code" "$name"
      continue
    fi
    if [ -n "$have" ]; then
      claude mcp remove --scope user "$name" >/dev/null 2>&1 \
        || warn "claude mcp remove $name failed"
    fi
    if claude mcp add-json --scope user "$name" "$want" >/dev/null; then
      echo "Registered MCP server $name with Claude Code"
    else
      warn "claude mcp add-json $name failed"
    fi
  done
  if $check; then return 0; fi
  for name in $(printf '%s' "$dropped" | "$jq" -r '.[]'); do
    if printf '%s' "$registered" | "$jq" -e --arg n "$name" 'has($n)' >/dev/null; then
      if claude mcp remove --scope user "$name" >/dev/null 2>&1; then
        echo "Removed MCP server $name from Claude Code"
      else
        warn "claude mcp remove $name failed"
      fi
    fi
  done
}

# ---- Codex ------------------------------------------------------------------
codex_sync() {
  if ! command -v codex >/dev/null 2>&1; then
    $check || warn "codex is unavailable; skipped its MCP servers"
    return 0
  fi
  local listing
  if ! listing="$(codex mcp list --json 2>/dev/null)" \
    || ! printf '%s' "$listing" | "$jq" -e 'type == "array"' >/dev/null 2>&1; then
    warn "codex mcp list failed; skipped Codex's MCP servers"
    return 0
  fi
  local name want have
  for name in $names; do
    want="$(printf '%s' "$declared" | "$jq" -c --arg n "$name" '.[$n] | {command, args, env}')"
    have="$(printf '%s' "$listing" | "$jq" -c --arg n "$name" \
      'map(select(.name == $n))[0].transport // empty
       | {command, args: (.args // []), env: (.env // {})}')"
    [ "$have" = "$want" ] && continue
    if $check; then
      missing "Codex" "$name"
      continue
    fi
    if [ -n "$have" ]; then
      codex mcp remove "$name" >/dev/null 2>&1 || warn "codex mcp remove $name failed"
    fi
    local add=(codex mcp add "$name")
    local kv
    while IFS= read -r kv; do
      if [ -n "$kv" ]; then add+=(--env "$kv"); fi
    done < <(printf '%s' "$want" | "$jq" -r '.env | to_entries[] | "\(.key)=\(.value)"')
    add+=(--)
    local arg
    while IFS= read -r -d '' arg; do
      add+=("$arg")
    done < <(printf '%s' "$want" | "$jq" -j '([.command] + .args)[] | ., "\u0000"')
    if "${add[@]}" >/dev/null 2>&1; then
      echo "Registered MCP server $name with Codex"
    else
      warn "codex mcp add $name failed"
    fi
  done
  if $check; then return 0; fi
  for name in $(printf '%s' "$dropped" | "$jq" -r '.[]'); do
    if printf '%s' "$listing" | "$jq" -e --arg n "$name" 'any(.[]; .name == $n)' >/dev/null; then
      if codex mcp remove "$name" >/dev/null 2>&1; then
        echo "Removed MCP server $name from Codex"
      else
        warn "codex mcp remove $name failed"
      fi
    fi
  done
}

# ---- Harnesses configured by one JSON file ------------------------------------
# The entry each harness's file holds for a server ({command, args, env}).
entry_jq='def entry($shape):
  if $shape == "opencode" then
    {type: "local", command: ([.command] + .args), environment: .env, enabled: true}
  elif $shape == "omp" then {type: "stdio"} + .
  else . end;'

# file_sync <label> <harness folder> <file> <key> <shape>: in <file>, under
# <key>, every declared server as <shape> has it, and no dropped one. Only
# where <harness folder> exists, so a harness that is not installed gets no
# file; a file that is there but is not plain JSON is left alone.
file_sync() {
  local label="$1" dir="$2" file="$3" key="$4" shape="$5"
  [ -d "$dir" ] || return 0
  local current='{}'
  if [ -s "$file" ]; then
    if ! current="$("$jq" -c '.' "$file" 2>/dev/null)" \
      || ! printf '%s' "$current" | "$jq" -e 'type == "object"' >/dev/null 2>&1; then
      warn "$file is not plain JSON; left it alone, so $label has no MCP servers from this repo"
      return 0
    fi
  fi
  if $check; then
    printf '%s' "$current" | "$jq" -r --argjson d "$declared" --arg k "$key" --arg s "$shape" \
      "$entry_jq"' . as $c | $d | to_entries[]
        | select(($c[$k] // {})[.key] != (.value | entry($s))) | .key' \
      | while IFS= read -r name; do missing "$label" "$name"; done
    return 0
  fi
  local next
  next="$(printf '%s' "$current" | "$jq" --argjson d "$declared" --argjson drop "$dropped" \
    --arg k "$key" --arg s "$shape" \
    "$entry_jq"' .[$k] = (((.[$k] // {}) | with_entries(select(.key as $n | $drop | index($n) | not)))
      + ($d | map_values(entry($s))))')" || {
    warn "cannot work out $label's MCP servers; left $file alone"
    return 0
  }
  [ "$(printf '%s' "$next" | "$jq" -c '.')" = "$current" ] && return 0
  local tmp
  if ! "$cu/mkdir" -p "$("$cu/dirname" "$file")" || ! tmp="$("$cu/mktemp" "$file.tmp.XXXXXX")"; then
    warn "cannot write next to $file; $label keeps what it has"
    return 0
  fi
  if printf '%s\n' "$next" >"$tmp" \
    && { [ ! -e "$file" ] || "$cu/chmod" --reference="$file" "$tmp"; } \
    && "$cu/mv" -f "$tmp" "$file"; then
    echo "Registered MCP servers with $label ($file)"
  else
    "$cu/rm" -f "$tmp"
    warn "cannot write $file; $label keeps what it has"
  fi
}

claude_sync
codex_sync
file_sync "Cursor" "$home/.cursor" "$home/.cursor/mcp.json" mcpServers plain
file_sync "Gemini CLI" "$home/.gemini" "$home/.gemini/settings.json" mcpServers plain
file_sync "Oh My Pi" "$home/.omp" "$home/.omp/agent/mcp.json" mcpServers omp
file_sync "opencode" "$home/.config/opencode" "$home/.config/opencode/opencode.json" mcp opencode

if ! $check; then
  if ! { printf '%s\n' "$names" >"$state/managed.tmp" && "$cu/mv" -f "$state/managed.tmp" "$state/managed"; }; then
    warn "cannot record the MCP servers this sync manages ($state/managed)"
  fi
fi
exit 0
