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
    cursor-cli # Cursor terminal agent (`agent` / `cursor-agent`)
    logseq-nightly # ARM64 app from Logseq's moving nightly GitHub release
    sqlite
    kubectl
    yt-dlp
    # azure-cli + git-credential-manager installed via Homebrew
    # (see modules/darwin/system/homebrew.nix). The Nix paths trigger a from-source
    # rebuild that pulls swift; brew gives signed binaries instantly.

    # Java
    graalvmPackages.graalvm-ce

    # PowerShell Core
    powershell

    # Python
    # Keep the workstation runtime explicit instead of following the moving
    # python3 alias. uv-managed tools that belong to this repo use the same
    # interpreter while retaining isolated dependency environments.
    python313
    python313Packages.pip
    uv

    # Rust
    rustc
    cargo

    # Node.js stack
    nodejs
    pnpm
    typescript
    typescript-language-server

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
