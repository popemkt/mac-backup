{ pkgs, ... }:

{
  home.packages = with pkgs; [
    # Repo-native outliner datastore; code lives in ~/.dotfiles/tools/kb,
    # data is per-repo (.kb/ discovered by walking cwd upward).
    (writeShellScriptBin "kb" ''
      exec ${bun}/bin/bun "$HOME/.dotfiles/tools/kb/src/surface/cli.ts" "$@"
    '')
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
    vite-plus # Unified Vite-based web toolchain (`vp`)
    logseq-nightly # ARM64 app from Logseq's moving nightly GitHub release
    chat2db # AI database client / SQL workspace (GitHub release DMG)
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
