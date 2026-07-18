{ pkgs, config, ... }:

let
  inherit (config.my) username;
in
{
  imports = [
    # Intent layer: functional stacks contributing to my.pkgs.* channel lists
    # and their per-tool daemons/config (ai-agents owns cli-proxy-api,
    # headroom, hermes).
    ../../stacks
    ./external-workspace.nix
    ./homebrew.nix
    ./input-sources.nix
    ./tailscale-services.nix
  ];

  # Keep the OS hostname in sync with the flake attribute name so
  # `darwin-rebuild --flake ~/.dotfiles` can auto-select this host.
  # Rebuild applies these via scutil — renaming a machine = rename the
  # flake attr + host dir, then rebuild once with the explicit new name.
  networking = {
    hostName = config.my.hostname;
    computerName = config.my.hostname;
    localHostName = config.my.hostname;
  };

  launchd.daemons.time-machine-local-snapshot-prune = {
    script = ''
      set -eu

      keep=3
      snapshots=$(/usr/bin/tmutil listlocalsnapshotdates / | /usr/bin/grep '-' | /usr/bin/sort || true)
      count=$(printf '%s\n' "$snapshots" | /usr/bin/grep -c '-' || true)

      if [ "$count" -le "$keep" ]; then
        exit 0
      fi

      printf '%s\n' "$snapshots" | /usr/bin/awk -v keep="$keep" '
        { snapshots[NR] = $0 }
        END {
          limit = NR - keep
          for (i = 1; i <= limit; i++) {
            print snapshots[i]
          }
        }
      ' | while IFS= read -r snapshot; do
        [ -n "$snapshot" ] && /usr/bin/tmutil deletelocalsnapshots "$snapshot"
      done
    '';
    serviceConfig = {
      StartCalendarInterval = [
        {
          Hour = 9;
          Minute = 15;
        }
        {
          Hour = 18;
          Minute = 15;
        }
      ];
      StandardOutPath = "/var/log/time-machine-local-snapshot-prune.log";
      StandardErrorPath = "/var/log/time-machine-local-snapshot-prune.log";
    };
  };

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
