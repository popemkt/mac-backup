# mcp-servers-sync: register the MCP servers the host's stacks declare
# (my.pkgs.mcpServers) with every agent harness this account has. ./default.nix
# prepends: home, servers (a JSON file: {name: {command, args, env} | {url}}), state
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
# - Hermes (config.yaml in its home): the same reconciliation, written with yq.
#
# A server already registered as declared is left alone; one registered
# differently is replaced. A name this sync registered in a harness before and
# no stack declares any more is removed from it, since its command is a store
# path that garbage collection will take. Each harness keeps its own record,
# $state/managed-<harness>, which changes only when that harness was
# reconciled: one skipped (CLI missing, listing failed, file not plain JSON)
# keeps its record, and a name whose removal failed stays in it, so the next
# run that reaches the harness removes it. A server a person registered under
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

canonical_jq='def transport:
  if .url != null then {url}
  else {command, args: (.args // []), env: (.env // {})} end;'
declared="$("$jq" -c "$canonical_jq map_values(transport)" "$servers")" || {
  warn "cannot read the declared MCP servers ($servers)"
  exit 0
}
names="$(printf '%s' "$declared" | "$jq" -r 'keys[]')"

# dropped_for <harness>: the names this sync registered with <harness> before
# that no stack declares now, one per line. A record it cannot read takes back
# nothing (and is rewritten only once the harness is reconciled).
dropped_for() {
  local record="$state/managed-$1"
  [ -s "$record" ] || return 0
  "$jq" -R -r --argjson d "$declared" '. as $n | select($n != "" and ($d | has($n) | not))' "$record" 2>/dev/null \
    || warn "cannot read $record; took back no MCP server from it"
}

# reconciled <harness> [<name>…]: <harness> now has every declared server
# this sync manages there, plus the given names, whose removal failed.
reconciled() {
  local harness="$1"
  shift
  $check && return 0
  if ! { { printf '%s\n' "$names"; printf '%s\n' "$@"; } | "$jq" -R -r 'select(. != "")' | "$cu/sort" -u >"$state/.managed-$harness" \
    && "$cu/mv" -f "$state/.managed-$harness" "$state/managed-$harness"; }; then
    warn "cannot record the MCP servers this sync manages in $harness ($state/managed-$harness)"
  fi
}

# Nothing declared and nothing to take back anywhere: no harness is asked
# anything.
if [ -z "$names" ]; then
  pending=false
  for record in "$state"/managed-*; do
    [ -s "$record" ] && pending=true
  done
  $pending || exit 0
fi

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
    want="$(printf '%s' "$declared" | "$jq" -c --arg n "$name" '.[$n] | if has("url") then {type: "http", url} else {type: "stdio"} + . end')"
    have="$(printf '%s' "$registered" | "$jq" -c --arg n "$name" \
      "$canonical_jq"' .[$n] // empty | {type: (.type // "stdio")} + transport')"
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
  local kept=()
  for name in $(dropped_for claude); do
    if printf '%s' "$registered" | "$jq" -e --arg n "$name" 'has($n)' >/dev/null; then
      if claude mcp remove --scope user "$name" >/dev/null 2>&1; then
        echo "Removed MCP server $name from Claude Code"
      else
        warn "claude mcp remove $name failed"
        kept+=("$name")
      fi
    fi
  done
  reconciled claude "${kept[@]}"
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
    want="$(printf '%s' "$declared" | "$jq" -c --arg n "$name" '.[$n]')"
    have="$(printf '%s' "$listing" | "$jq" -c --arg n "$name" \
      "$canonical_jq"' map(select(.name == $n))[0].transport // empty | transport')"
    [ "$have" = "$want" ] && continue
    if $check; then
      missing "Codex" "$name"
      continue
    fi
    if [ -n "$have" ]; then
      codex mcp remove "$name" >/dev/null 2>&1 || warn "codex mcp remove $name failed"
    fi
    local add=(codex mcp add "$name")
    local url kv arg
    url="$(printf '%s' "$want" | "$jq" -r '.url // empty')"
    if [ -n "$url" ]; then
      add+=(--url "$url")
    else
      while IFS= read -r kv; do
        add+=(--env "$kv")
      done < <(printf '%s' "$want" | "$jq" -r '.env | to_entries[] | "\(.key)=\(.value)"')
      add+=(--)
      while IFS= read -r -d '' arg; do
        add+=("$arg")
      done < <(printf '%s' "$want" | "$jq" -j '([.command] + .args)[] | ., "\u0000"')
    fi
    if "${add[@]}" >/dev/null 2>&1; then
      echo "Registered MCP server $name with Codex"
    else
      warn "codex mcp add $name failed"
    fi
  done
  if $check; then return 0; fi
  local kept=()
  for name in $(dropped_for codex); do
    if printf '%s' "$listing" | "$jq" -e --arg n "$name" 'any(.[]; .name == $n)' >/dev/null; then
      if codex mcp remove "$name" >/dev/null 2>&1; then
        echo "Removed MCP server $name from Codex"
      else
        warn "codex mcp remove $name failed"
        kept+=("$name")
      fi
    fi
  done
  reconciled codex "${kept[@]}"
}

# ---- Harnesses configured by one JSON file ------------------------------------
# The server entry for each file-based harness.
entry_jq='def entry($shape):
  if has("url") then
    if $shape == "opencode" then {type: "remote", url, enabled: true}
    elif $shape == "gemini" then {httpUrl: .url}
    elif $shape == "omp" then {type: "http", url}
    else . end
  elif $shape == "opencode" then
    {type: "local", command: ([.command] + .args), environment: .env, enabled: true}
  elif $shape == "omp" then {type: "stdio"} + .
  else . end;'

read_config() {
  local format="$1" file="$2"
  if [ "$format" = hermes ]; then
    "$yq" -N -o=json -I=0 '(. // {})' "$file"
  else
    "$jq" -c '.' "$file"
  fi
}

write_config() {
  local format="$1" file="$2" key="$3" next="$4"
  if [ "$format" = hermes ]; then
    local entries
    entries="$(printf '%s' "$next" | "$jq" -c --arg key "$key" '.[$key]')" || return
    if [ -s "$file" ]; then
      MCP_ENTRIES="$entries" "$yq" '.mcp_servers = env(MCP_ENTRIES)' "$file"
    else
      printf '%s
' "$next" | "$yq" -P
    fi
  else
    printf '%s
' "$next"
  fi
}

# file_sync <harness> <label> <harness folder> <file> <key> <shape>: in
# <file>, under <key>, every declared server as <shape> has it, and no dropped
# one. Only where <harness folder> exists, so a harness that is not installed
# gets no file; a file that is there but is not plain JSON is left alone.
file_sync() {
  local harness="$1"
  shift
  local label="$1" dir="$2" file="$3" key="$4" shape="$5"
  [ -d "$dir" ] || return 0
  local current='{}'
  if [ -s "$file" ]; then
    if ! current="$(read_config "$shape" "$file" 2>/dev/null)" \
      || ! printf '%s' "$current" | "$jq" -es 'length == 1 and (.[0] | type == "object")' >/dev/null 2>&1; then
      if [ "$shape" = hermes ]; then
        warn "$file is not a readable YAML object; left it alone ($label)"
      else
        warn "$file is not plain JSON; left it alone ($label)"
      fi
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
  local next dropped
  dropped="$(dropped_for "$harness" | "$jq" -R -s -c 'split("\n") | map(select(. != ""))')" || dropped='[]'
  next="$(printf '%s' "$current" | "$jq" --argjson d "$declared" --argjson drop "$dropped" \
    --arg k "$key" --arg s "$shape" \
    "$entry_jq"' .[$k] = (((.[$k] // {}) | with_entries(select(.key as $n | $drop | index($n) | not)))
      + ($d | map_values(entry($s))))')" || {
    warn "cannot work out $label's MCP servers; left $file alone"
    return 0
  }
  if [ "$(printf '%s' "$next" | "$jq" -c '.')" = "$current" ]; then
    reconciled "$harness"
    return 0
  fi
  local tmp
  if ! "$cu/mkdir" -p "$("$cu/dirname" "$file")" || ! tmp="$("$cu/mktemp" "$file.tmp.XXXXXX")"; then
    warn "cannot write next to $file; $label keeps what it has"
    return 0
  fi
  if write_config "$shape" "$file" "$key" "$next" >"$tmp" \
    && { [ ! -e "$file" ] || "$cu/chmod" --reference="$file" "$tmp"; } \
    && "$cu/mv" -f "$tmp" "$file"; then
    echo "Registered MCP servers with $label ($file)"
    reconciled "$harness"
  else
    "$cu/rm" -f "$tmp"
    warn "cannot write $file; $label keeps what it has"
  fi
}

claude_sync
codex_sync
file_sync cursor "Cursor" "$home/.cursor" "$home/.cursor/mcp.json" mcpServers plain
file_sync gemini "Gemini CLI" "$home/.gemini" "$home/.gemini/settings.json" mcpServers gemini
file_sync omp "Oh My Pi" "$home/.omp" "$home/.omp/agent/mcp.json" mcpServers omp
file_sync opencode "opencode" "$home/.config/opencode" "$home/.config/opencode/opencode.json" mcp opencode
file_sync hermes "Hermes" "$hermesHome" "$hermesHome/config.yaml" mcp_servers hermes
exit 0
