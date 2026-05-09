{ pkgs, username, ... }:

{
  # ============================================================================
  # PRIMARY USER (required for many system settings)
  # ============================================================================

  system.primaryUser = username;

  # ============================================================================
  # NIX SETTINGS
  # ============================================================================

  # Let Determinate Nix manage the nix installation
  nix.enable = false;

  # Allow unfree packages (like vscode)
  nixpkgs.config.allowUnfree = true;

  # ============================================================================
  # SYSTEM PACKAGES (available globally)
  # ============================================================================

  environment.systemPackages = with pkgs; [
    vim
    git
    curl
  ];

  # ============================================================================
  # HOMEBREW (GUI Apps)
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
      "ghostwright/ghost-os"
      "skyhook-io/tap"
    ];

    # CLI tools from Homebrew (prefer Nix for these, but some work better via brew)
    brews = [
      # "awscli"
      # Brew over Nix: `azure-cli.withExtensions` rebuilds from source (pulls
      # swift). Brew's azure-cli ships a working Python+pip so dynamic
      # `az extension add azure-devops` works without nix wrapping.
      "azure-cli"
      "copilot"
      # Google Workspace CLI for Gmail/Drive/Sheets/etc.
      # Keep this in Brew so `gws` is easy to restore on macOS.
      "googleworkspace-cli"
      "ghostwright/ghost-os/ghost-os"
      "ollama"
      "radar"
      "zellij"
    ];

    # GUI Applications
    casks = [
      # Development
      "visual-studio-code"
      "claude"
      "zed"
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

      # Productivity
      "raycast"
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
      # "rectangle"
      # "cleanshot"
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

  # ============================================================================
  # macOS SYSTEM SETTINGS
  # ============================================================================

  system.defaults = {
    # Dock
    dock = {
      autohide = true;
      show-recents = false;
      # Minimize to application icon
      minimize-to-application = true;
      # Don't rearrange spaces based on recent use
      mru-spaces = false;
    };

    # Finder
    finder = {
      ShowPathbar = true;
      ShowStatusBar = true;
      # Show all file extensions
      AppleShowAllExtensions = true;
      # Default to list view
      FXPreferredViewStyle = "Nlsv";
    };

    # Global settings
    NSGlobalDomain = {
      # Enable tap to click
      "com.apple.mouse.tapBehavior" = 1;
      # Fast key repeat
      KeyRepeat = 2;
      InitialKeyRepeat = 15;
      # Show all file extensions
      AppleShowAllExtensions = true;
      # Allow macOS to auto-terminate idle apps with no windows
      NSDisableAutomaticTermination = false;
    };

    # Trackpad
    trackpad = {
      Clicking = true; # Tap to click
      TrackpadRightClick = true;
    };
  };

  # Enable Touch ID for sudo (new API)
  security.pam.services.sudo_local.touchIdAuth = true;

  # ============================================================================
  # SYSTEM STATE VERSION
  # ============================================================================

  # Used for backwards compatibility
  system.stateVersion = 5;

  # The platform the configuration will be used on
  nixpkgs.hostPlatform = "aarch64-darwin"; # Change for Intel
}
