_:

{
  # ============================================================================
  # HOMEBREW
  # ============================================================================

  homebrew = {
    enable = true;

    # What to do with apps not in this list:
    # "none"   = leave them alone (relaxed, good while experimenting)
    # "zap"    = remove them (strict, full reproducibility)
    onActivation = {
      cleanup = "none"; # Change to "zap" when your config is complete
      autoUpdate = true;
      upgrade = true;
    };

    # Homebrew taps
    taps = [
      # "homebrew/bundle"  # Uncomment if needed
      "coleam00/archon"
      "entireio/tap"
      "ghostwright/ghost-os"
      "stablyai/orca"
    ];

    # CLI tools from Homebrew (prefer Nix for these, but some work better via brew)
    brews = [
      # "awscli"
      # Brew over Nix: `azure-cli.withExtensions` rebuilds from source (pulls
      # swift). Brew's azure-cli ships a working Python+pip so dynamic
      # `az extension add azure-devops` works without nix wrapping.
      "azure-cli"
      # Google Workspace CLI for Gmail/Drive/Sheets/etc.
      # Keep this in Brew so `gws` is easy to restore on macOS.
      "googleworkspace-cli"
      # Oh My Pi requires Bun >= 1.3.14; Homebrew currently ships a newer
      # runtime than nixpkgs and upgrades it during rebuild activation.
      "bun"
      "coleam00/archon/archon"
      "ghostwright/ghost-os/ghost-os"
      "ollama"
      "zellij"
    ];

    # GUI Applications
    casks = [
      # Development
      "visual-studio-code"
      "claude"
      "claude-code@latest"
      "chatgpt"
      "entireio/tap/entire"
      # Use the fully-qualified tap path. Bare "orca" is the unrelated Plotly cask.
      "stablyai/orca/orca"
      "zed"
      "copilot-cli" # GitHub Copilot CLI (agentic terminal assistant)
      # Google Cloud CLI ships as a Homebrew cask, not a formula.
      # Required by `gws auth setup`.
      "gcloud-cli"
      "rustdesk"
      "tailscale-app"
      "warp"
      # "iterm2"
      # "docker"
      # "tableplus"

      # Browsers
      # "arc"
      # "firefox"
      "browseros"
      "google-chrome@beta"

      # Productivity
      "raycast"
      "tana"
      # "notion"
      # "obsidian"
      # "1password"

      # Communication
      # "slack"
      "discord"
      "lens"
      # "zoom"

      # Utilities
      "alt-tab"
      "antigravity-cli"
      # "rectangle"
      # "cleanshot"
      "middleclick"
      "karabiner-elements"
      # Brew over Nix: nixpkgs git-credential-manager pulls swift toolchain
      # on macOS. Brew ships the prebuilt signed binary.
      "git-credential-manager"
    ];

    # Mac App Store apps (requires `mas` CLI)
    # Get IDs from: https://github.com/mas-cli/mas
    masApps = {
      # "Magnet" = 441258766;
    };
  };
}
