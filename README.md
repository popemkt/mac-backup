# dotfiles

My declarative macOS setup using **nix-darwin** + **home-manager** + **Homebrew** + **Mackup**.

One command to rule them all: `rebuild`

## What This Does

| Component | Tool | Config Location |
|-----------|------|-----------------|
| CLI tools & shell | Nix + Home Manager | `modules/home.nix` |
| GUI apps | Homebrew (managed by Nix) | `modules/darwin.nix` |
| macOS settings | nix-darwin | `modules/darwin.nix` |
| GUI app configs | Mackup | iCloud (or configured storage) |

## Quick Start (New Machine)

```bash
# 1. Clone this repo
git clone git@github.com:popemkt/dotfiles.git ~/.dotfiles

# 2. Run setup
~/.dotfiles/bootstrap.sh

# 3. Restart your terminal
```

The bootstrap script will:
1. Install Nix (Determinate Systems installer)
2. Install Homebrew
3. Build and apply the full configuration
4. Set up Mackup for GUI app config backup

## Structure

```
~/.dotfiles/
├── flake.nix              # Entry point (inputs, outputs)
├── modules/
│   ├── darwin.nix         # macOS settings + Homebrew casks
│   └── home.nix           # CLI tools + shell + dotfiles
├── configs/               # Additional config files (nvim, etc.)
├── .mackup.cfg            # Mackup configuration
├── bootstrap.sh           # First-time setup script
└── README.md
```

## Daily Usage

### Apply Configuration Changes

After editing any config file:

```bash
rebuild    # alias for: darwin-rebuild switch --flake ~/.dotfiles
```

### Update All Packages

```bash
# Update flake inputs (nixpkgs, home-manager, etc.)
cd ~/.dotfiles
nix flake update

# Rebuild with updated packages
rebuild

# Update Homebrew apps (happens automatically on rebuild, or manually):
brew update && brew upgrade
```

## Adding Apps & Packages

### Adding a GUI App (Homebrew Cask)

**Quick install now, track later:**

```bash
# Install immediately
cask add raycast

# This installs AND reminds you to add to config
```

**Check what's untracked:**

```bash
brew-hierarchycheck

# Output:
# 📦 Untracked casks (installed but not in config):
#    discord
#    zoom
```

**Add to config:**

Edit `~/.dotfiles/modules/darwin.nix`:

```nix
homebrew = {
  casks = [
    "raycast"    # Add here
    # ...
  ];
};
```

Then run `rebuild`.

### Adding a CLI Tool (Nix)

1. Search for package: [search.nixos.org/packages](https://search.nixos.org/packages)

2. Edit `~/.dotfiles/modules/home.nix`:

```nix
home.packages = with pkgs; [
  ripgrep
  newpackage    # Add here
];
```

3. Run `rebuild`

## Homebrew Cleanup Modes

In `modules/darwin.nix`:

```nix
homebrew = {
  onActivation.cleanup = "none";   # Leave untracked apps alone
  # or
  onActivation.cleanup = "zap";    # Remove apps not in config
};
```

**Recommended workflow:**
1. Start with `"none"` while experimenting
2. Use `brew-hierarchycheck` to see untracked apps
3. Add the ones you want to keep to config
4. Switch to `"zap"` for full reproducibility

## macOS Settings

System preferences are declared in `modules/darwin.nix`:

```nix
system.defaults = {
  dock.autohide = true;
  finder.ShowPathbar = true;
  NSGlobalDomain.KeyRepeat = 2;
  # ... etc
};
```

Changes apply on `rebuild`. Some settings require logout/restart.

## GUI App Configs (Mackup)

Mackup backs up settings for apps like VSCode, iTerm2, Raycast, etc.

```bash
# Backup your current app configs
mackup backup

# Restore on a new machine
mackup restore

# See what's being tracked
mackup list
```

Configure in `~/.mackup.cfg`:

```ini
[storage]
engine = icloud    # or: dropbox, google_drive, file_system

[applications_to_ignore]
zsh                # Managed by home-manager
git                # Managed by home-manager
```

## Useful Commands

| Command | Description |
|---------|-------------|
| `rebuild` | Apply all config changes |
| `brew-hierarchycheck` | Show untracked Homebrew casks |
| `cask add <name>` | Install cask + reminder to add to config |
| `mackup backup` | Backup GUI app configs |
| `mackup restore` | Restore GUI app configs |
| `nix flake update` | Update all Nix inputs |

## Customization

### Add Your Git Info

Edit `modules/home.nix`:

```nix
programs.git = {
  userName = "Your Name";
  userEmail = "you@example.com";
};
```

### Add Shell Aliases

Edit `modules/home.nix`:

```nix
programs.zsh.shellAliases = {
  myalias = "my command";
};
```

### Add Neovim Config

1. Place your config in `configs/nvim/`
2. Uncomment in `modules/home.nix`:

```nix
home.file.".config/nvim" = {
  source = ../configs/nvim;
  recursive = true;
};
```

3. Run `rebuild`

## Troubleshooting

### "hostname not found in flake"

Update `hostname` in `flake.nix` to match your Mac's hostname:

```bash
hostname -s    # Shows your hostname
```

### "command not found: darwin-rebuild"

Restart your terminal after first bootstrap.

### Nix is slow on first run

Normal - it's downloading packages. Subsequent runs are cached.

### Existing dotfiles conflict

Back them up first:

```bash
mv ~/.zshrc ~/.zshrc.backup
mv ~/.gitconfig ~/.gitconfig.backup
```

## Starting Fresh

If things break:

```bash
# Remove current config
darwin-rebuild --rollback

# Or full reset
/nix/nix-installer uninstall
rm -rf ~/.dotfiles
# Then re-clone and bootstrap
```

## Philosophy

- **CLI tools**: Nix (reproducible, cross-platform)
- **GUI apps**: Homebrew (best macOS integration)
- **Config tracking**: Everything in one git repo
- **Low friction**: `cask add` for quick installs, track later

## License

MIT
