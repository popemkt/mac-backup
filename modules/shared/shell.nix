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
