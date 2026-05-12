_:

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

      # HERMES_HOME is set per-platform via home.sessionVariables
      # (see modules/darwin/default.nix on macOS).

      # Fix ECONNRESET errors in Claude Code on macOS
      export NODE_OPTIONS="--dns-result-order=ipv4first"

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

        if [ "$1" = "update" ] && [ -n "$2" ]; then
          npm install -g "$2" || return 1
          return 0
        fi

        if [ "$1" = "update-all" ]; then
          local packages
          packages=$(sed -n '/npmGlobalPackages = \[/,/\];/p' "$config_file" | grep -oE '"[^"]+"' | tr -d '"')

          if [ -z "$packages" ]; then
            echo "No tracked npm global packages found in $config_file"
            return 1
          fi

          echo "$packages" | while read -r pkg; do
            [ -n "$pkg" ] || continue
            echo "Updating $pkg..."
            npm install -g "$pkg" || return 1
          done
          return 0
        fi

        if [ "$1" = "list" ]; then
          npm ls -g --depth=0
          return 0
        fi

        if [ "$1" = "outdated" ]; then
          npm outdated -g || true
          return 0
        fi

        echo "Usage: npmg add <package[@version]>"
        echo "       npmg update <package[@version]>"
        echo "       npmg update-all"
        echo "       npmg list"
        echo "       npmg outdated"
      }

      sysaudit() {
        "$HOME/.dotfiles/scripts/audit-system-discrepancies.sh"
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
