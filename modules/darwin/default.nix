{ lib, hostname, ... }:

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
    # Nix rebuild alias (darwin-specific)
    rebuild = "sudo darwin-rebuild switch --flake ~/.dotfiles#${hostname}";
  };

  programs.zsh.initContent = lib.mkAfter ''
    # ========================================
    # HOMEBREW HELPERS (macOS only)
    # ========================================

    # Show casks installed but not in your nix config
    brew-check() {
      echo "Checking for untracked casks..."
      echo ""

      local config_file="$HOME/.dotfiles/hosts/darwin/default.nix"
      local installed=$(brew list --cask 2>/dev/null | sort)
      local configured=$(grep -v '^\s*#' "$config_file" | grep -oE '"[a-zA-Z0-9-]+"' | tr -d '"' | sort | uniq)

      local untracked=$(echo "$installed" | while read -r cask; do
        echo "$configured" | grep -q "^$cask$" || echo "$cask"
      done)

      if [ -z "$untracked" ]; then
        echo "All casks are tracked in config!"
      else
        echo "Untracked casks (installed but not in config):"
        echo ""
        echo "$untracked" | while read -r cask; do
          echo "   $cask"
        done
        echo ""
        echo "Add them to: $config_file"
      fi
    }

    # Install a cask and remind to add to config
    cask() {
      if [ "$1" = "add" ] && [ -n "$2" ]; then
        brew install --cask "$2"
        echo ""
        echo "Don't forget to add to ~/.dotfiles/hosts/darwin/default.nix:"
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
