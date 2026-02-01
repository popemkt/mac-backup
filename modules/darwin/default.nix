{ config, pkgs, lib, ... }:

{
  # ============================================================================
  # DARWIN-SPECIFIC HOME-MANAGER SETTINGS
  # ============================================================================

  # macOS-specific shell additions
  programs.zsh.shellAliases = {
    # Nix rebuild alias (darwin-specific)
    rebuild = "darwin-rebuild switch --flake ~/.dotfiles";
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
