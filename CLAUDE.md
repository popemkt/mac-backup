# Claude Code Context

This file provides context for Claude Code sessions working on this repo.

## Project Overview

Declarative macOS setup using:
- **nix-darwin** - macOS system configuration
- **home-manager** - User environment (CLI tools, dotfiles)
- **Homebrew** - GUI apps (managed declaratively via nix-darwin)
- **Mackup** - GUI app settings backup

## File Structure

```
~/.dotfiles/
├── flake.nix              # Nix flake entry point
├── modules/
│   ├── darwin.nix         # macOS settings + Homebrew casks
│   └── home.nix           # CLI tools + shell config + dotfiles
├── configs/               # Additional config files (nvim, etc.)
├── docs/                  # Reference documentation
├── .mackup.cfg            # Mackup configuration
├── bootstrap.sh           # First-time setup script
└── README.md
```

## Allowed Commands

These commands are safe to run:

```bash
# Apply configuration changes
darwin-rebuild switch --flake ~/.dotfiles

# Update flake inputs
cd ~/.dotfiles && nix flake update

# Check flake validity
nix flake check

# Install Homebrew cask (temporary, before adding to config)
brew install --cask <name>

# Check untracked casks
brew list --cask

# Mackup operations
mackup backup
mackup restore

# Git operations
git add/commit/push (standard workflow)
```

## Common Tasks

### Add a CLI tool
1. Edit `modules/home.nix` → `home.packages`
2. Run `darwin-rebuild switch --flake ~/.dotfiles`

### Add a GUI app
1. Edit `modules/darwin.nix` → `homebrew.casks`
2. Run `darwin-rebuild switch --flake ~/.dotfiles`

### Add macOS system setting
1. Edit `modules/darwin.nix` → `system.defaults`
2. Run `darwin-rebuild switch --flake ~/.dotfiles`

### Add shell alias
1. Edit `modules/home.nix` → `programs.zsh.shellAliases`
2. Run `darwin-rebuild switch --flake ~/.dotfiles`

## User Info

- **GitHub:** popemkt
- **Git name:** Hoang Nguyen Gia
- **Git email:** hoangng71299@gmail.com
- **System:** Apple Silicon Mac (aarch64-darwin)

## Notes

- Hostname in `flake.nix` must match actual hostname (`hostname -s`)
- `homebrew.onActivation.cleanup = "none"` allows manual brew installs
- Change to `"zap"` for strict reproducibility (removes unlisted apps)
- GUI app configs backed up via Mackup to iCloud

## Commit Style

```
<type>: <short description>

Co-Authored-By: Claude <model> <noreply@anthropic.com>
```

Types: feat, fix, docs, refactor, chore

## Reference Repos

For more advanced patterns, see:
- [dustinlyons/nixos-config](https://github.com/dustinlyons/nixos-config) - Cross-platform (macOS + NixOS), secrets management, multi-host
- [Misterio77/nix-starter-configs](https://github.com/Misterio77/nix-starter-configs) - Minimal templates
- [ryan4yin/nix-darwin-kickstarter](https://github.com/ryan4yin/nix-darwin-kickstarter) - macOS focused

Our setup is intentionally simpler (macOS only, no secrets management). See `docs/nix-concepts.md` for comparison.
