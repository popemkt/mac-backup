{ pkgs, ... }:

{
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
    tmux
    tldr
    gh # GitHub CLI
    gemini-cli # Google Gemini CLI
    sqlite
    kubectl
    yt-dlp
    # azure-cli + git-credential-manager installed via Homebrew
    # (see hosts/darwin/default.nix). The Nix paths trigger a from-source
    # rebuild that pulls swift; brew gives signed binaries instantly.

    # Java
    graalvmPackages.graalvm-ce

    # PowerShell Core
    powershell

    # Python
    python3
    python3Packages.pip

    # Node.js stack
    nodejs
    bun
    pnpm
    nodePackages.typescript
    nodePackages.typescript-language-server

    # Neovim dependencies
    lua-language-server
    stylua
    nil

    # Nix tooling
    statix # anti-pattern lint
    deadnix # unused-binding finder
    nixfmt # official formatter (RFC-166)
  ];
}
