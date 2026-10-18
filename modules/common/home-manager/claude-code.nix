{ lib, pkgs, ... }:

# Claude Code's user settings stay machine state (/config and other tools
# write them; mackup syncs them on the Macs), so this merges only the keys it
# owns into ~/.claude/settings.json rather than replacing the file.
let
  # Compact at 400k tokens on every host, in the terminal and in sessions T3
  # Code starts. The variable outranks Claude Code's own auto-compact setting.
  env = {
    CLAUDE_CODE_AUTO_COMPACT_WINDOW = "400000";
  };
in
{
  home.activation.mergeClaudeCodeSettings = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    settings="$HOME/.claude/settings.json"
    # Write through a symlink (mackup's) instead of replacing it.
    [ -L "$settings" ] && settings="$(readlink -f "$settings")"
    $DRY_RUN_CMD mkdir -p "$(dirname "$settings")"
    [ -s "$settings" ] || $DRY_RUN_CMD sh -c 'echo "{}" > "$1"' _ "$settings"
    if [ -z "''${DRY_RUN_CMD:-}" ]; then
      tmp="$(mktemp)"
      ${lib.getExe pkgs.jq} --argjson env ${lib.escapeShellArg (builtins.toJSON env)} \
        '.env = ((.env // {}) + $env)' "$settings" > "$tmp"
      command cat "$tmp" > "$settings"
      rm -f "$tmp"
    fi
  '';
}
