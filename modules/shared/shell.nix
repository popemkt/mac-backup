{ config, pkgs, ... }:

{
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
    };

    initContent = ''
      # Homebrew (Apple Silicon)
      if [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
      fi

      # fzf integration
      if [ -n "$(command -v fzf)" ]; then
        source <(fzf --zsh)
      fi

      # PATH additions
      export PATH="$HOME/bin:$HOME/.local/bin:$PATH"

      # npm global helper (paired with modules/shared/npm-global.nix)
      npmg() {
        local config_file="$HOME/.dotfiles/modules/shared/npm-global.nix"

        if [ "$1" = "add" ] && [ -n "$2" ]; then
          npm install -g "$2" || return 1
          echo ""
          echo "Add this to $config_file for reproducible installs:"
          echo ""
          echo "  \"$2\""
          return 0
        fi

        if [ "$1" = "list" ]; then
          npm ls -g --depth=0
          return 0
        fi

        echo "Usage: npmg add <package[@version]>"
        echo "       npmg list"
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
  # STARSHIP PROMPT
  # ============================================================================

  programs.starship = {
    enable = true;
    enableZshIntegration = true;
    settings = {
      add_newline = false;
      command_timeout = 1000;
    };
  };
}
