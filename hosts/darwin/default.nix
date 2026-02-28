{ pkgs, ... }:

{
  # ============================================================================
  # PRIMARY USER (required for many system settings)
  # ============================================================================

  system.primaryUser = "popemkt";

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
    onActivation.cleanup = "none";  # Change to "zap" when your config is complete
    onActivation.autoUpdate = true;
    onActivation.upgrade = true;

    # Homebrew taps
    taps = [
      # "homebrew/bundle"  # Uncomment if needed
    ];

    # CLI tools from Homebrew (prefer Nix for these, but some work better via brew)
    brews = [
      # "awscli"
    ];

    # GUI Applications
    casks = [
      # Development
      "visual-studio-code"
      "claude"
      # "warp"
      # "iterm2"
      # "docker"
      # "tableplus"

      # Browsers
      # "arc"
      # "firefox"

      # Productivity
      # "raycast"
      # "notion"
      # "obsidian"
      # "1password"

      # Communication
      # "slack"
      # "discord"
      # "zoom"

      # Utilities
      # "rectangle"
      # "cleanshot"
      # "karabiner-elements"
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
    };

    # Trackpad
    trackpad = {
      Clicking = true;  # Tap to click
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
  nixpkgs.hostPlatform = "aarch64-darwin";  # Change for Intel
}
