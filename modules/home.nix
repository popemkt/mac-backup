{ config, pkgs, username, ... }:

{
  home.username = username;
  home.homeDirectory = "/Users/${username}";
  home.stateVersion = "24.05";

  programs.home-manager.enable = true;

  # ============================================================================
  # PACKAGES
  # ============================================================================

  home.packages = with pkgs; [
    # Dev essentials
    ripgrep
    fzf
    jq
    htop
    tree
    fd
    bat
    eza
    delta
    lazygit
    tldr
    gh             # GitHub CLI

    # Node.js stack
    nodejs
    pnpm
    nodePackages.typescript
    nodePackages.typescript-language-server

    # Neovim dependencies
    lua-language-server
    stylua
    nil
  ];

  # ============================================================================
  # GIT
  # ============================================================================

  programs.git = {
    enable = true;
    userName = "Hoang Nguyen Gia";
    userEmail = "hoangng71299@gmail.com";
    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
      core.pager = "delta";
      interactive.diffFilter = "delta --color-only";
      delta = {
        navigate = true;
        light = false;
        line-numbers = true;
      };
      merge.conflictStyle = "diff3";
      diff.colorMoved = "default";
    };
    aliases = {
      s = "status";
      co = "checkout";
      br = "branch";
      ci = "commit";
      lg = "log --oneline --graph --decorate";
    };
  };

  # ============================================================================
  # ZSH
  # ============================================================================

  programs.zsh = {
    enable = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    shellAliases = {
      # Navigation
      ll = "eza -la";
      ls = "eza";
      cat = "bat";

      # Git
      gs = "git status";
      gd = "git diff";
      gc = "git commit";
      gp = "git push";
      gl = "git pull";
      lg = "lazygit";

      # Nix
      rebuild = "darwin-rebuild switch --flake ~/.dotfiles";
    };

    initExtra = ''
      # fzf integration
      if [ -n "$(command -v fzf)" ]; then
        source <(fzf --zsh)
      fi

      # PATH additions
      export PATH="$HOME/bin:$HOME/.local/bin:$PATH"

      # ========================================
      # HOMEBREW HELPERS
      # ========================================

      # Show casks installed but not in your nix config
      brew-hierarchycheck() {
        echo "Checking for untracked casks..."
        echo ""

        local config_file="$HOME/.dotfiles/modules/darwin.nix"
        local installed=$(brew list --cask 2>/dev/null | sort)
        local configured=$(grep -oE '"[a-zA-Z0-9-]+"' "$config_file" | tr -d '"' | sort | uniq)

        local untracked=""
        for cask in $installed; do
          if ! echo "$configured" | grep -q "^$cask$"; then
            untracked="$untracked$cask\n"
          fi
        done

        if [ -z "$untracked" ]; then
          echo "✅ All casks are tracked in config!"
        else
          echo "📦 Untracked casks (installed but not in config):"
          echo ""
          echo "$untracked" | while read -r cask; do
            [ -n "$cask" ] && echo "   $cask"
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
          echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
          echo "📝 Don't forget to add to ~/.dotfiles/modules/darwin.nix:"
          echo ""
          echo "   casks = ["
          echo "     \"$2\""
          echo "     ..."
          echo "   ];"
          echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        else
          echo "Usage: cask add <cask-name>"
          echo ""
          echo "This installs a cask and reminds you to add it to your config."
          echo "Run 'brew-hierarchycheck' to see all untracked casks."
        fi
      }
    '';

    history = {
      size = 10000;
      save = 10000;
      ignoreDups = true;
      ignoreAllDups = true;
      share = true;
    };
  };

  # ============================================================================
  # OTHER PROGRAMS
  # ============================================================================

  programs.neovim = {
    enable = true;
    defaultEditor = true;
    viAlias = true;
    vimAlias = true;
  };

  programs.starship = {
    enable = true;
    enableZshIntegration = true;
    settings = {
      add_newline = false;
      command_timeout = 1000;
    };
  };

  programs.direnv = {
    enable = true;
    enableZshIntegration = true;
    nix-direnv.enable = true;
  };

  # ============================================================================
  # DOTFILES (link additional config files)
  # ============================================================================

  # Example: Neovim config
  # home.file.".config/nvim" = {
  #   source = ../configs/nvim;
  #   recursive = true;
  # };
}
