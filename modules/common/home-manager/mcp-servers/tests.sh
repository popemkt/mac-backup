# Run by ./tests.nix: $first and $second are mcp-servers-sync as ./default.nix
# builds it for two sets of declared servers, for the home $placeholderHome.
set -euo pipefail

H="$PWD/home"
export FAKE="$PWD/fake"
mkdir -p "$H/bin" "$H/.local/bin" "$FAKE" "$H/.cursor" "$H/.omp/agent" "$H/.config/opencode"
for s in first second http; do
  sed "s#$placeholderHome#$H#g" "${!s}" >"$H/bin/$s"
done
chmod +x "$H/bin/"*

# claude: its user-scope servers live in ~/.claude.json, as Claude Code's do.
# codex: its servers in $FAKE/codex.json, listed as `codex mcp list --json`
# does. Each fails every call while $FAKE/fail-<name> exists.
cat >"$H/.local/bin/claude" <<F
#!$shell
echo "claude \$*" >>"\$FAKE/log"
[ -e "\$FAKE/fail-claude" ] && exit 1
c="$H/.claude.json"
[ -s "\$c" ] || echo '{}' >"\$c"
case "\$1 \$2 \$3 \$4" in
  "mcp remove --scope user") [ -e "\$FAKE/fail-claude-remove" ] && exit 1 ;;
esac
case "\$1 \$2 \$3 \$4" in
  "mcp add-json --scope user") $jq --arg n "\$5" --argjson s "\$6" '.mcpServers[\$n] = \$s' "\$c" >"\$c.n" && mv "\$c.n" "\$c" ;;
  "mcp remove --scope user") $jq --arg n "\$5" 'del(.mcpServers[\$n])' "\$c" >"\$c.n" && mv "\$c.n" "\$c" ;;
  *) echo "fake claude: unexpected \$*" >&2; exit 9 ;;
esac
F
cat >"$H/.local/bin/codex" <<F
#!$shell
echo "codex \$*" >>"\$FAKE/log"
[ -e "\$FAKE/fail-codex" ] && exit 1
c="\$FAKE/codex.json"
[ -s "\$c" ] || echo '[]' >"\$c"
case "\$1 \$2" in
  "mcp list") [ "\$3" = --json ] && cat "\$c" ;;
  "mcp remove") $jq --arg n "\$3" 'map(select(.name != \$n))' "\$c" >"\$c.n" && mv "\$c.n" "\$c" ;;
  "mcp add")
    n="\$3"; shift 3; env='{}'
    if [ "\$1" = --url ]; then
      $jq --arg n "\$n" --arg url "\$2" \
        'map(select(.name != \$n)) + [{name: \$n, enabled: true, transport: {type: "streamable_http", url: \$url}}]' \
        "\$c" >"\$c.n" && mv "\$c.n" "\$c"
      exit \$?
    fi
    while [ "\$1" = --env ]; do env="\$(echo "\$env" | $jq --arg kv "\$2" '. + {(\$kv | split("=")[0]): (\$kv | split("=")[1:] | join("="))}')"; shift 2; done
    [ "\$1" = -- ] && shift
    cmd="\$1"; shift
    args='[]'
    for a in "\$@"; do args="\$(echo "\$args" | $jq -c --arg a "\$a" '. + [\$a]')"; done
    $jq --arg n "\$n" --arg cmd "\$cmd" --argjson args "\$args" --argjson env "\$env" \
      'map(select(.name != \$n)) + [{name: \$n, enabled: true, transport: {type: "stdio", command: \$cmd, args: \$args, env: (if \$env == {} then null else \$env end), env_vars: [], cwd: null}}]' \
      "\$c" >"\$c.n" && mv "\$c.n" "\$c" ;;
  *) echo "fake codex: unexpected \$*" >&2; exit 9 ;;
esac
F
chmod +x "$H/.local/bin/"*
export PATH="$H/.local/bin:$PATH"

fail() {
  echo "FAIL: $*" >&2
  echo "--- calls" >&2
  cat "$FAKE/log" >&2 || true
  echo "--- out" >&2
  cat "$FAKE/out" >&2 || true
  exit 1
}
run() {
  : >"$FAKE/log"
  "$@" >"$FAKE/out" 2>&1 || fail "$* exited $?"
}
called() { grep -qF "$1" "$FAKE/log" || fail "no call: $1"; }
not_called() { ! grep -qF "$1" "$FAKE/log" || fail "unexpected call: $1"; }
is() { [ "$1" = "$2" ] || fail "$3: got $1, expected $2"; }
kbroot='/Users/me/Library/Application Support/kb/home'

# A person's own servers stay: one in Claude Code, one in Cursor, and
# opencode's other settings.
echo '{"mcpServers":{"mine":{"type":"stdio","command":"/bin/mine","args":[],"env":{}}},"numStartups":3}' >"$H/.claude.json"
echo '{"mcpServers":{"mine":{"url":"http://x"}}}' >"$H/.cursor/mcp.json"
echo '{"$schema":"https://opencode.ai/config.json","theme":"x"}' >"$H/.config/opencode/opencode.json"
chmod 600 "$H/.cursor/mcp.json"

# 1. First registration: every harness that is there; Gemini CLI is not.
run "$H/bin/first"
is "$($jq -c '.mcpServers["kb-work"]' "$H/.claude.json")" \
  "{\"type\":\"stdio\",\"command\":\"/nix/store/kb/bin/kb\",\"args\":[\"--root\",\"$kbroot\",\"mcp\"],\"env\":{}}" "Claude Code's kb-work"
is "$($jq -r '.mcpServers.mine.command, .numStartups' "$H/.claude.json" | tr '\n' ' ')" "/bin/mine 3 " "Claude Code's own"
is "$($jq -c '.[] | select(.name == "kb-work") | .transport.args' "$FAKE/codex.json")" "[\"--root\",\"$kbroot\",\"mcp\"]" "Codex's kb-work args"
is "$($jq -r '.[] | select(.name == "other") | .transport.env.TOKEN_FILE' "$FAKE/codex.json")" "/run/other token" "Codex's env"
is "$($jq -c '.mcpServers | keys' "$H/.cursor/mcp.json")" '["kb-work","mine","other"]' "Cursor's servers"
is "$(stat -c %a "$H/.cursor/mcp.json")" 600 "Cursor's file mode"
is "$($jq -r '.mcpServers["kb-work"].type' "$H/.omp/agent/mcp.json")" stdio "Oh My Pi's type"
is "$($jq -c '.mcp.other' "$H/.config/opencode/opencode.json")" \
  '{"type":"local","command":["/nix/store/other/bin/other"],"environment":{"TOKEN_FILE":"/run/other token"},"enabled":true}' "opencode's other"
is "$($jq -r '.theme' "$H/.config/opencode/opencode.json")" x "opencode's own settings"
[ ! -e "$H/.gemini" ] || fail "a Gemini CLI folder was made"

# 2. Nothing to do: no harness call but the listing, no file written.
before="$(stat -c %Y.%i "$H/.cursor/mcp.json")"
run "$H/bin/first"
not_called "add"
not_called "remove"
is "$(stat -c %Y.%i "$H/.cursor/mcp.json")" "$before" "an unchanged Cursor file"
run "$H/bin/first" --check
is "$(cat "$FAKE/out")" "" "--check with nothing missing"

# 3. --check after a person removed one, and with Gemini CLI installed since.
mkdir "$H/.gemini"
$jq 'del(.mcpServers.other)' "$H/.cursor/mcp.json" >"$H/c" && mv "$H/c" "$H/.cursor/mcp.json"
run "$H/bin/first" --check
grep -qxF "Cursor: other" "$FAKE/out" || fail "--check missed Cursor's other"
grep -qxF "Gemini CLI: kb-work" "$FAKE/out" || fail "--check missed Gemini CLI"
not_called "add"
[ ! -e "$H/.gemini/settings.json" ] || fail "--check wrote a file"

# 4. One changed, one dropped: replaced and removed everywhere; a person's
# own stay.
run "$H/bin/second"
is "$($jq -c '.mcpServers["kb-work"].args' "$H/.claude.json")" '["--root","/elsewhere","mcp"]' "Claude Code's changed kb-work"
called "claude mcp remove --scope user other"
is "$($jq -c '.mcpServers | keys' "$H/.claude.json")" '["kb-work","mine"]' "Claude Code's servers after"
is "$($jq -c 'map(.name)' "$FAKE/codex.json")" '["kb-work"]' "Codex's servers after"
is "$($jq -c '.mcpServers | keys' "$H/.cursor/mcp.json")" '["kb-work","mine"]' "Cursor's servers after"
is "$($jq -c '.mcpServers | keys' "$H/.gemini/settings.json")" '["kb-work"]' "Gemini CLI's servers"
is "$($jq -c '.mcp | keys' "$H/.config/opencode/opencode.json")" '["kb-work"]' "opencode's servers after"

# 4b. A server dropped while a harness could not be reconciled is removed
# from it once it can be: Codex's listing fails, then recovers; Claude Code's
# removal fails, then works.
run "$H/bin/first"
touch "$FAKE/fail-codex" "$FAKE/fail-claude-remove"
run "$H/bin/second"
grep -q "warning: claude mcp remove other failed" "$FAKE/out" || fail "no warning for the failed removal"
is "$($jq -c '.mcpServers | keys' "$H/.cursor/mcp.json")" '["kb-work","mine"]' "Cursor, reconciled meanwhile"
rm "$FAKE/fail-codex" "$FAKE/fail-claude-remove"
run "$H/bin/second"
is "$($jq -c 'map(.name) | sort' "$FAKE/codex.json")" '["kb-work"]' "Codex's servers after it recovered"
is "$($jq -c '.mcpServers | keys' "$H/.claude.json")" '["kb-work","mine"]' "Claude Code's servers after the removal worked"
run "$H/bin/second"
not_called "remove"
not_called "add"

# Exercise the HTTP form in each harness, then drop it through the same path.
export HERMES_HOME="$H/hermes-profile"
mkdir "$HERMES_HOME"
printf '# Preserve my comment\nmodel: my-model\n' >"$HERMES_HOME/config.yaml"
run "$H/bin/http"
endpoint=http://127.0.0.1:8001/mcp
called "codex mcp add endpoint --url $endpoint"
is "$($jq -c '.mcpServers.endpoint' "$H/.claude.json")" \
  "{\"type\":\"http\",\"url\":\"$endpoint\"}" "Claude HTTP entry"
is "$($jq -r '.mcpServers.endpoint.url' "$H/.cursor/mcp.json")" "$endpoint" "Cursor HTTP entry"
is "$($jq -r '.mcpServers.endpoint.httpUrl' "$H/.gemini/settings.json")" "$endpoint" "Gemini HTTP entry"
is "$($jq -c '.mcpServers.endpoint' "$H/.omp/agent/mcp.json")" \
  "{\"type\":\"http\",\"url\":\"$endpoint\"}" "Oh My Pi HTTP entry"
is "$($jq -c '.mcp.endpoint' "$H/.config/opencode/opencode.json")" \
  "{\"type\":\"remote\",\"url\":\"$endpoint\",\"enabled\":true}" "opencode HTTP entry"
is "$($yq '.mcp_servers.endpoint.url' "$HERMES_HOME/config.yaml")" "$endpoint" "Hermes HTTP entry"
grep -q '^# Preserve my comment$' "$HERMES_HOME/config.yaml" || fail "Hermes comment lost"
before=$(stat -c %Y.%i "$HERMES_HOME/config.yaml")
run "$H/bin/http"
not_called "add"
not_called "remove"
is "$(stat -c %Y.%i "$HERMES_HOME/config.yaml")" "$before" "unchanged Hermes config"
run "$H/bin/http" --check
is "$(cat "$FAKE/out")" "" "HTTP --check with nothing missing"
run "$H/bin/second"
is "$($yq '.mcp_servers.endpoint' "$HERMES_HOME/config.yaml")" null "Hermes removed HTTP entry"
is "$($yq '.model' "$HERMES_HOME/config.yaml")" my-model "Hermes own setting"

# 5. Failed listings are never read as "nothing registered"; a file that is
# not plain JSON is left alone. Each warns, and the sync exits 0.
touch "$FAKE/fail-codex"
echo '{ // a comment
}' >"$H/.config/opencode/opencode.json"
$jq '.mcpServers["kb-work"].args = []' "$H/.cursor/mcp.json" >"$H/c" && mv "$H/c" "$H/.cursor/mcp.json"
run "$H/bin/second"
grep -q "warning: codex mcp list failed" "$FAKE/out" || fail "no warning for codex's failed listing"
not_called "codex mcp add"
grep -q "opencode.json is not plain JSON" "$FAKE/out" || fail "no warning for opencode's comments"
grep -q "a comment" "$H/.config/opencode/opencode.json" || fail "opencode's file was rewritten"
is "$($jq -c '.mcpServers["kb-work"].args' "$H/.cursor/mcp.json")" '["--root","/elsewhere","mcp"]' "Cursor restored"
rm "$FAKE/fail-codex"

# 6. No claude or codex at all: warned, files still converge.
rm "$H/.local/bin/claude" "$H/.local/bin/codex"
rm "$H/.omp/agent/mcp.json"
run "$H/bin/second"
grep -q "warning: claude is unavailable" "$FAKE/out" || fail "no warning for a missing claude"
is "$($jq -c '.mcpServers | keys' "$H/.omp/agent/mcp.json")" '["kb-work"]' "Oh My Pi without the CLIs"

echo "mcp-servers: all checks passed"
