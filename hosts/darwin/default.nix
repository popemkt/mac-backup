{ pkgs, config, ... }:

let
  inherit (config.my) username;
in
{
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

  # /etc/synthetic.conf entries (read by apfs.util at boot):
  #   nix            - empty mountpoint for the Determinate /nix APFS volume (fstab)
  #   stuff -> /Volumes/Data - symlink to external drive workspace
  # nix-darwin already appends `run`; we append the rest (custom-named
  # activation scripts are not wired in, hence extraActivation).
  # Takes effect after reboot.
  system.activationScripts.extraActivation.text = ''
    if ! /usr/bin/grep -q '^nix$' /etc/synthetic.conf 2>/dev/null; then
      echo "adding nix mountpoint to /etc/synthetic.conf..."
      echo 'nix' | /usr/bin/tee -a /etc/synthetic.conf >/dev/null
    fi
    if ! /usr/bin/grep -q '^stuff\b' /etc/synthetic.conf 2>/dev/null; then
      echo "adding /stuff -> /Volumes/Data to /etc/synthetic.conf..."
      /usr/bin/printf 'stuff\t/Volumes/Data\n' | /usr/bin/tee -a /etc/synthetic.conf >/dev/null
    fi
  '';

  # Global launchd user-domain env vars (via `launchctl setenv`).
  # Inherited by all user launchd jobs AND by terminal apps launched from
  # Dock/Spotlight — so shells see it for free without an `export` in shell.nix.
  # Unless the agent's plist sets the same key inline, which overrides.
  # Global launchd user-domain env vars (via `launchctl setenv`) — inherited by
  # all launchd jobs AND apps launched from Dock/Spotlight, so every app/shell
  # sees them without an `export`.
  launchd.user.envVariables = {
    HERMES_HOME = "/stuff/workspace/repos/_brain/.agents/hermes/profile/popemkt";

    # Headroom proxy endpoint, exposed to all apps. Apps opt in by routing their
    # provider base_url here (e.g. package.json `*:proxy` scripts read
    # HEADROOM_PROXY). NOT setting ANTHROPIC_BASE_URL/OPENAI_BASE_URL globally on
    # purpose — that would force-route every client through the proxy and break
    # them if the daemon is down. Flip to auto-route only if you want that.
    HEADROOM_PROXY = "http://localhost:8787";
    HEADROOM_PORT = "8787";
  };

  # Headroom context-compression proxy — always-on user daemon.
  # Runs the uv-tool-installed binary (declared in modules/shared/uv-tools.nix
  # as headroom-ai[all]); home-manager activation installs it. On a fresh build,
  # KeepAlive retries until that install lands, then the proxy comes up.
  # Projects route their agents at $HEADROOM_PROXY (http://localhost:8787).
  launchd.user.agents.headroom-proxy = {
    serviceConfig = {
      ProgramArguments = [
        "/Users/${username}/.local/bin/headroom"
        "proxy"
        "--port"
        "8787"
      ];
      RunAtLoad = true;
      KeepAlive = true;
      StandardOutPath = "/Users/${username}/Library/Logs/headroom-proxy.out.log";
      StandardErrorPath = "/Users/${username}/Library/Logs/headroom-proxy.err.log";
      EnvironmentVariables = {
        PATH = "/Users/${username}/.local/bin:${pkgs.uv}/bin:/usr/bin:/bin:/usr/sbin:/sbin";
      };
    };
  };

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
      "codex-app"
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

    CustomUserPreferences = {
      "com.apple.HIToolbox" = {
        AppleEnabledInputSources = [
          # Base Latin keyboard layout.
          {
            InputSourceKind = "Keyboard Layout";
            "KeyboardLayout ID" = 0;
            "KeyboardLayout Name" = "U.S.";
          }
          # Built-in Vietnamese Telex input method.
          {
            InputSourceKind = "Input Mode";
            "Bundle ID" = "com.apple.inputmethod.VietnameseIM";
            "Input Mode" = "com.apple.inputmethod.VietnameseTelex";
          }
        ];
        AppleSelectedInputSources = [
          # Keep U.S. first so it remains the default selected layout.
          {
            InputSourceKind = "Keyboard Layout";
            "KeyboardLayout ID" = 0;
            "KeyboardLayout Name" = "U.S.";
          }
          # Make Vietnamese Telex visible in the input switcher.
          {
            InputSourceKind = "Input Mode";
            "Bundle ID" = "com.apple.inputmethod.VietnameseIM";
            "Input Mode" = "com.apple.inputmethod.VietnameseTelex";
          }
        ];
        AppleInputSourceHistory = [
          # Mirror the selectable layouts so Text Input services rebuild their menu.
          {
            InputSourceKind = "Keyboard Layout";
            "KeyboardLayout ID" = 0;
            "KeyboardLayout Name" = "U.S.";
          }
          {
            InputSourceKind = "Input Mode";
            "Bundle ID" = "com.apple.inputmethod.VietnameseIM";
            "Input Mode" = "com.apple.inputmethod.VietnameseTelex";
          }
        ];
      };
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
