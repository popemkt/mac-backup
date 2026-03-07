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
    gemini-cli     # Google Gemini CLI
    sqlite
    kubectl

    # Java
    graalvmPackages.graalvm-ce

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
