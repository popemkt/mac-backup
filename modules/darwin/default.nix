{ lib, ... }:

{
  # ============================================================================
  # DARWIN-SPECIFIC HOME-MANAGER SETTINGS
  # ============================================================================

  home = {
    # Surface Homebrew bins on PATH for interactive shells.
    # NOTE: launchd-spawned GUI apps don't read this — set per-agent envs
    # in their plist, or globally via `launchd.user.envVariables`
    # (nix-darwin scope, e.g. HERMES_HOME in hosts/darwin/default.nix).
    sessionPath = [ "/opt/homebrew/bin" ];

    file.".mackup.cfg".text = ''
      [storage]
      engine = icloud

      [applications_to_sync]
      alt-tab
      karabiner-elements
      warp
      zed
      vscode
      telegram_macos
      claude-code
      macosx
    '';

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

    sessionVariables = {
      # Hermes auxiliary ACP uses the Homebrew Copilot CLI on macOS.
      HERMES_COPILOT_ACP_COMMAND = "/opt/homebrew/bin/copilot";

      # Mirrors launchd.user.envVariables.HERMES_HOME (hosts/darwin/default.nix).
      # Launchd line covers GUI apps; this covers interactive shells where
      # the launchd setenv lands in the wrong bootstrap domain at activate-time.
      HERMES_HOME = "/stuff/workspace/repos/_brain/.agents/hermes/profile/popemkt";
    };

  };

  # macOS-specific shell additions
  programs.zsh.shellAliases = {
    # Nix rebuild alias (darwin-specific). No #attr — darwin-rebuild picks
    # darwinConfigurations.<hostname> at runtime, and networking.* keeps the
    # hostname synced to the flake attr. Only a machine RENAME needs an
    # explicit one-off: sudo darwin-rebuild switch --flake ~/.dotfiles#<newname>
    rebuild = "sudo darwin-rebuild switch --flake ~/.dotfiles && ~/.dotfiles/scripts/audit-system-discrepancies.sh";
  };

  programs.zsh.initContent = lib.mkAfter ''
    # ========================================
    # HOMEBREW HELPERS (macOS only)
    # ========================================

    # Full drift audit (brew, npm, uv, nix, /Applications) — also runs
    # automatically after `rebuild`.
    brew-check() {
      "$HOME/.dotfiles/scripts/audit-system-discrepancies.sh"
    }

    # Install a cask and remind to add to config
    cask() {
      if [ "$1" = "add" ] && [ -n "$2" ]; then
        brew install --cask "$2"
        echo ""
        echo "Don't forget to add to ~/.dotfiles/modules/darwin-system/homebrew.nix:"
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
