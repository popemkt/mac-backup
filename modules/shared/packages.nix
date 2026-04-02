{ config, pkgs, ... }:

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
    gh             # GitHub CLI
    gemini-cli     # Google Gemini CLI
    sqlite
    kubectl

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
  ];
}
