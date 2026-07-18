{ lib, ... }:

{
  imports = [
    ./bun-global.nix
    ./mackup.nix
  ];

  # ============================================================================
  # DARWIN-SPECIFIC HOME-MANAGER SETTINGS
  # ============================================================================

  home = {
    # Surface Homebrew bins on PATH for interactive shells.
    # NOTE: launchd-spawned GUI apps don't read this — set per-agent envs
    # in their plist, or globally via `launchd.user.envVariables`
    # (nix-darwin scope, e.g. HERMES_HOME in modules/darwin/system/hermes.nix).
    sessionPath = [ "/opt/homebrew/bin" ];

    file.".orca/keybindings.json".text = builtins.toJSON {
      version = 1;
      keybindings = { };
      platforms = {
        darwin = {
          "terminal.clear" = [ ];
          "worktree.palette" = [ "Mod+K" ];
        };
        linux = { };
        win32 = { };
      };
    };

  };

  programs.zsh.initContent = lib.mkAfter ''
    # Homebrew (Apple Silicon)
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi

    # Fix ECONNRESET errors in Claude Code on macOS.
    export NODE_OPTIONS="--dns-result-order=ipv4first"

    # Run Claude Code's harness against GPT-5.6 Sol through the local
    # CLIProxyAPI service without changing normal `claude` sessions.
    claudex() {
      ANTHROPIC_BASE_URL="http://127.0.0.1:8317/v1" \
      ANTHROPIC_AUTH_TOKEN="freecc" \
      CLAUDE_CODE_SUBAGENT_MODEL="gpt-5.6-sol" \
      CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1 \
      CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=3 \
      ENABLE_TOOL_SEARCH=false \
        command claude --model "gpt-5.6-sol" "$@"
    }

    # CLT-only installs do not expose the macOS SDK automatically. Native
    # extensions such as hnswlib need this path during compilation.
    export SDKROOT="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)"

    # Best-effort release discovery is informational and never mutates pins.
    # No #attr is needed: darwin-rebuild selects the host-matching config.
    rebuild() {
      nix run "$HOME/.dotfiles#github-sources" -- check --best-effort
      local source_status=$?

      if (( source_status == 10 )); then
        echo "warning: rebuilding with current pins; run the suggested update command when ready" >&2
      elif (( source_status != 0 )); then
        echo "warning: release check could not run; continuing with pinned sources" >&2
      fi

      sudo darwin-rebuild switch --flake "$HOME/.dotfiles" &&
        "$HOME/.dotfiles/scripts/audit-system-discrepancies.sh"
    }

    # ========================================
    # HOMEBREW HELPERS (macOS only)
    # ========================================

    # Full drift audit (brew, npm, Bun, uv, nix, /Applications) — also runs
    # automatically after `rebuild`.
    brew-check() {
      "$HOME/.dotfiles/scripts/audit-system-discrepancies.sh"
    }

    # Install a cask and remind to add to config
    cask() {
      if [ "$1" = "add" ] && [ -n "$2" ]; then
        brew install --cask "$2"
        echo ""
        echo "Don't forget to add to ~/.dotfiles/modules/darwin/system/homebrew.nix:"
        echo ""
        echo "   casks = ["
        echo "     \"$2\""
        echo "     ..."
        echo "   ];"
      else
        echo "Usage: cask add <cask-name>"
        echo ""
        echo "This installs a cask and reminds you to add it to your config."
        echo "Run 'brew-check' to see all untracked casks."
      fi
    }
  '';

  # macOS-specific packages (if any)
  # home.packages = with pkgs; [ ];
}
