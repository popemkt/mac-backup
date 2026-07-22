{ lib, pkgs, ... }:

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

    # Homebrew dependencies may surface their own moving python3. Keep the
    # interactive runtime aligned with the Nix-owned 3.13 tool baseline.
    export PATH="${pkgs.python313}/bin:$PATH"

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

    # Apply the declared state without discovering or upgrading remote packages.
    rebuild() {
      sudo darwin-rebuild switch --flake "$HOME/.dotfiles" &&
        "$HOME/.dotfiles/scripts/audit-system-discrepancies.sh" &&
        system-setup status --advisory
    }

    # Prepare reviewable repository updates without mutating the live system.
    update-system() {
      local dotfiles_root="$HOME/.dotfiles"

      (
        set -e
        cd "$dotfiles_root"
        nix flake update
        nix run .#github-sources -- update
        nix run .#github-sources -- verify
        nix flake check --no-build

        echo "Prepared system updates. Review with:"
        echo "  git -C \"$dotfiles_root\" diff -- flake.lock _sources/"
        echo "Apply when ready with: apply-system-update"
      )
    }

    # Apply prepared pins, update mutable package-manager declarations, then
    # publish only the repository-managed pin files.
    apply-system-update() {
      local dotfiles_root="$HOME/.dotfiles"

      (
        set -e
        cd "$dotfiles_root"
        sudo darwin-rebuild switch --flake "$dotfiles_root"
        # These helpers now come from the just-activated configuration, so
        # they use its declared Homebrew/npm/Bun package sets.
        update-homebrew
        update-npm-globals
        update-bun-globals
        "$dotfiles_root/scripts/audit-system-discrepancies.sh"

        if ! git diff --quiet HEAD -- flake.lock _sources/; then
          git add -- flake.lock _sources/
          git commit --only -m "chore: update system pins" -- flake.lock _sources/
          git push origin HEAD
        else
          echo "No system pin changes to commit."
        fi
      )
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
