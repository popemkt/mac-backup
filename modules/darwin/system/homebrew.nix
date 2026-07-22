{
  config,
  lib,
  pkgs,
  ...
}:

let
  declaredBrewfile = pkgs.writeText "dotfiles-Brewfile" config.homebrew.brewfile;
  updateHomebrew = pkgs.writeShellScriptBin "update-homebrew" ''
    set -euo pipefail

    export HOMEBREW_DOWNLOAD_CONCURRENCY=1
    /opt/homebrew/bin/brew update
    HOMEBREW_NO_AUTO_UPDATE=1 /opt/homebrew/bin/brew bundle \
      --file=${declaredBrewfile} \
      --no-lock
  '';
in
{
  # ============================================================================
  # HOMEBREW (executor)
  # ============================================================================
  # Base lists below hold channel-native entries with no stack membership.
  # Stack-owned software lives in modules/stacks/* and arrives merged via
  # config.my.pkgs.*; lib.unique collapses tag-style multi-stack entries.

  homebrew = {
    enable = true;

    # What to do with apps not in this list:
    # "none"   = leave them alone (relaxed, good while experimenting)
    # "zap"    = remove them (strict, full reproducibility)
    onActivation = {
      cleanup = "none"; # Change to "zap" when your config is complete
      # Routine rebuilds install missing declarations but never discover or
      # apply upgrades. `update-system` owns that explicit network boundary.
      autoUpdate = false;
      upgrade = false;
    };

    # Homebrew taps
    taps = lib.unique (
      [
        # "homebrew/bundle"  # Uncomment if needed
        "entireio/tap"
        "ghostwright/ghost-os"
      ]
      ++ config.my.pkgs.taps
    );

    # CLI tools from Homebrew (prefer Nix for these, but some work better via brew)
    brews = lib.unique (
      [
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
        "ghostwright/ghost-os/ghost-os"
        "zellij"
      ]
      ++ config.my.pkgs.brews
    );

    # GUI Applications
    casks = lib.unique (
      [
        # Development
        "visual-studio-code"
        "entireio/tap/entire"
        "zed"
        # Google Cloud CLI ships as a Homebrew cask, not a formula.
        # Required by `gws auth setup`.
        "gcloud-cli"
        # Android adb/fastboot: for pushing files to Android devices over USB.
        # Bypasses macOS ptpcamerad claiming the MTP interface.
        "android-platform-tools"
        "rustdesk"
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
        "snapzy"
        # "rectangle"
        # "cleanshot"
        "middleclick"
        "karabiner-elements"
        # Brew over Nix: nixpkgs git-credential-manager pulls swift toolchain
        # on macOS. Brew ships the prebuilt signed binary.
        "git-credential-manager"
      ]
      ++ config.my.pkgs.casks
    );

    # Mac App Store apps (requires `mas` CLI)
    # Get IDs from: https://github.com/mas-cli/mas
    masApps = {
      # "Magnet" = 441258766;
    };
  };

  environment.systemPackages = [ updateHomebrew ];
}
