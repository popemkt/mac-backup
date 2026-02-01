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
}
