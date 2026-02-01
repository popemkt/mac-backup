# Claude Code Context

This file provides context for Claude Code sessions working on this repo.

## Project Overview

Cross-platform declarative system configuration using:
- **nix-darwin** - macOS system configuration
- **NixOS** - Linux system configuration
- **home-manager** - User environment (CLI tools, dotfiles)
- **Homebrew** - GUI apps on macOS (managed declaratively via nix-darwin)
- **Mackup** - GUI app settings backup (macOS)

## File Structure

```
~/.dotfiles/
├── flake.nix                    # Entry point - defines all system configurations
├── hosts/
│   ├── darwin/
│   │   └── default.nix          # macOS system settings + Homebrew
│   └── nixos/
│       └── default.nix          # Linux system settings
├── home/
│   ├── darwin.nix               # macOS home-manager entry point
│   └── nixos.nix                # Linux home-manager entry point
├── modules/
│   ├── shared/                  # Cross-platform modules (used by both)
│   │   ├── default.nix          # Imports all shared modules
│   │   ├── git.nix              # Git configuration
│   │   ├── packages.nix         # CLI tools (ripgrep, fzf, etc.)
│   │   ├── shell.nix            # Zsh + Starship
│   │   └── neovim.nix           # Neovim + Direnv
│   ├── darwin/
│   │   └── default.nix          # macOS-specific home-manager settings
│   └── nixos/
│       └── default.nix          # Linux-specific home-manager settings
├── configs/                     # Additional config files (nvim, etc.)
├── docs/                        # Reference documentation
├── .mackup.cfg                  # Mackup configuration (macOS)
└── bootstrap.sh                 # First-time setup script (macOS)
```

## Allowed Commands

### macOS

```bash
# Apply configuration changes
darwin-rebuild switch --flake ~/.dotfiles#popemkt-mac

# Or use the alias
rebuild
```

### Linux (NixOS)

```bash
# Apply configuration changes
sudo nixos-rebuild switch --flake ~/.dotfiles#nixos

# Or use the alias
rebuild
```

### Both Platforms

```bash
# Update flake inputs
cd ~/.dotfiles && nix flake update

# Check flake validity
nix flake check

# Git operations
git add/commit/push (standard workflow)
```

## Common Tasks

### Add a CLI tool (both platforms)
1. Edit `modules/shared/packages.nix` → `home.packages`
2. Run `rebuild`

### Add macOS-only package
1. Edit `modules/darwin/default.nix` → `home.packages`
2. Run `rebuild`

### Add Linux-only package
1. Edit `modules/nixos/default.nix` → `home.packages`
2. Run `rebuild`

### Add a GUI app (macOS)
1. Edit `hosts/darwin/default.nix` → `homebrew.casks`
2. Run `rebuild`

### Add macOS system setting
1. Edit `hosts/darwin/default.nix` → `system.defaults`
2. Run `rebuild`

### Add shell alias (both platforms)
1. Edit `modules/shared/shell.nix` → `programs.zsh.shellAliases`
2. Run `rebuild`

### Add a new machine
1. Add entry to `flake.nix` in appropriate section
2. Customize `hosts/<platform>/default.nix` if needed
3. Run rebuild with `--flake ~/.dotfiles#<hostname>`

## User Info

- **GitHub:** popemkt
- **Git name:** Hoang Nguyen Gia
- **Git email:** hoangng71299@gmail.com
- **System:** Apple Silicon Mac (aarch64-darwin)

## Notes

- Hostname in `flake.nix` must match actual hostname (`hostname -s`)
- `homebrew.onActivation.cleanup = "none"` allows manual brew installs
- Change to `"zap"` for strict reproducibility (removes unlisted apps)
- GUI app configs backed up via Mackup to iCloud (macOS only)
- The `mkDarwin` and `mkNixOS` helper functions simplify adding new machines

## Cross-Platform Tips

- Put platform-agnostic config in `modules/shared/`
- Use `lib.optionals pkgs.stdenv.isDarwin [...]` for conditional packages
- Use `lib.mkIf pkgs.stdenv.isLinux { ... }` for conditional options
- The `rebuild` alias automatically uses the correct command for each platform

## Commit Style

```
<type>: <short description>

Co-Authored-By: Claude <model> <noreply@anthropic.com>
```

Types: feat, fix, docs, refactor, chore

## Reference Repos

For more advanced patterns, see:
- [dustinlyons/nixos-config](https://github.com/dustinlyons/nixos-config) - Cross-platform, secrets management, multi-host
- [Misterio77/nix-starter-configs](https://github.com/Misterio77/nix-starter-configs) - Minimal templates
- [ryan4yin/nix-darwin-kickstarter](https://github.com/ryan4yin/nix-darwin-kickstarter) - macOS focused
