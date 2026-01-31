# nix-darwin Options Reference

Common options for `modules/darwin.nix`.

Full list: [nix-darwin manual](https://daiderd.com/nix-darwin/manual/index.html)

## Homebrew

```nix
homebrew = {
  enable = true;

  # Cleanup behavior
  onActivation.cleanup = "none";    # Leave manual installs
  onActivation.cleanup = "uninstall"; # Remove unlisted (keeps in Caskroom)
  onActivation.cleanup = "zap";     # Full removal of unlisted

  onActivation.autoUpdate = true;   # brew update on rebuild
  onActivation.upgrade = true;      # brew upgrade on rebuild

  # Taps
  taps = [
    "homebrew/services"
  ];

  # CLI formulas (prefer Nix, but some need brew)
  brews = [
    "awscli"
  ];

  # GUI apps
  casks = [
    "visual-studio-code"
    "raycast"
  ];

  # Mac App Store
  masApps = {
    "Magnet" = 441258766;
    "1Password" = 1333542190;
  };
};
```

## System Defaults

### Dock

```nix
system.defaults.dock = {
  autohide = true;
  autohide-delay = 0.0;
  autohide-time-modifier = 0.4;
  show-recents = false;
  static-only = false;          # Only show running apps
  minimize-to-application = true;
  mru-spaces = false;           # Don't rearrange spaces
  orientation = "bottom";       # "left", "bottom", "right"
  tilesize = 48;
};
```

### Finder

```nix
system.defaults.finder = {
  ShowPathbar = true;
  ShowStatusBar = true;
  AppleShowAllExtensions = true;
  AppleShowAllFiles = false;    # Show hidden files
  FXEnableExtensionChangeWarning = false;
  FXPreferredViewStyle = "Nlsv"; # List view
  # "icnv" = icon, "Nlsv" = list, "clmv" = column, "glyv" = gallery
  QuitMenuItem = true;          # Allow Quit Finder
  _FXShowPosixPathInTitle = true;
};
```

### Global (NSGlobalDomain)

```nix
system.defaults.NSGlobalDomain = {
  # Keyboard
  KeyRepeat = 2;                # Fast repeat (lower = faster)
  InitialKeyRepeat = 15;        # Delay before repeat
  ApplePressAndHoldEnabled = false; # Disable accent menu

  # Mouse/Trackpad
  "com.apple.mouse.tapBehavior" = 1;  # Tap to click
  "com.apple.swipescrolldirection" = true; # Natural scrolling

  # Interface
  AppleInterfaceStyle = "Dark";  # Dark mode
  AppleShowAllExtensions = true;
  AppleShowScrollBars = "Always"; # "WhenScrolling", "Automatic", "Always"

  # Typing
  NSAutomaticCapitalizationEnabled = false;
  NSAutomaticSpellingCorrectionEnabled = false;
  NSAutomaticPeriodSubstitutionEnabled = false;
};
```

### Trackpad

```nix
system.defaults.trackpad = {
  Clicking = true;              # Tap to click
  TrackpadRightClick = true;    # Two-finger right click
  TrackpadThreeFingerDrag = true;
};
```

### Login Window

```nix
system.defaults.loginwindow = {
  GuestEnabled = false;
  DisableConsoleAccess = true;
};
```

### Screensaver

```nix
system.defaults.screensaver = {
  askForPassword = true;
  askForPasswordDelay = 5;      # Seconds
};
```

### Screenshots

```nix
system.defaults.screencapture = {
  location = "~/Screenshots";
  type = "png";                 # "png", "jpg", "pdf", "gif"
  disable-shadow = true;
};
```

## Security

```nix
# Touch ID for sudo
security.pam.enableSudoTouchIdAuth = true;
```

## System Packages

```nix
# Available globally (not per-user)
environment.systemPackages = with pkgs; [
  vim
  git
];
```

## Shells

```nix
# Set default shell for users
users.users.yourusername.shell = pkgs.zsh;

# Add shell to allowed shells
environment.shells = [ pkgs.zsh ];

# Make zsh the default
programs.zsh.enable = true;
```

## Fonts

```nix
fonts.packages = with pkgs; [
  (nerdfonts.override { fonts = [ "JetBrainsMono" "FiraCode" ]; })
  inter
];
```

## Keyboard

```nix
system.keyboard = {
  enableKeyMapping = true;
  remapCapsLockToEscape = true;
  # remapCapsLockToControl = true;
};
```

## Power Management

```nix
power = {
  sleep.display = 10;           # Minutes
  sleep.computer = 30;
};
```
