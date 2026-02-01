# Claude Code Context

This file provides context for Claude Code sessions working on this repo.

## Project Overview

Cross-platform declarative system configuration using:
- **nix-darwin** - macOS system configuration
- **NixOS** - Linux system configuration (template ready)
- **home-manager** - User environment (CLI tools, dotfiles)
- **Homebrew** - GUI apps on macOS (managed declaratively via nix-darwin)
- **Determinate Nix** - Nix installation manager

## File Structure

```
~/.dotfiles/
├── flake.nix                    # Entry point - defines all system configurations
├── flake.lock                   # Locked dependencies
├── hosts/
│   ├── darwin/
│   │   └── default.nix          # macOS system settings + Homebrew
│   └── nixos/
│       └── default.nix          # Linux system settings (template)
├── modules/
│   ├── shared/                  # Cross-platform modules (used by both)
│   │   ├── default.nix          # Imports all shared modules
│   │   ├── git.nix              # Git configuration
│   │   ├── packages.nix         # CLI tools (ripgrep, fzf, etc.)
│   │   ├── shell.nix            # Zsh + Starship
│   │   └── neovim.nix           # Neovim + Direnv
│   ├── darwin/
│   │   └── default.nix          # macOS-specific home-manager (brew helpers)
│   └── nixos/
│       └── default.nix          # Linux-specific home-manager
├── configs/                     # Additional config files (nvim, etc.)
├── docs/                        # Reference documentation
├── .mackup.cfg                  # Mackup configuration (macOS)
└── bootstrap.sh                 # First-time setup script (macOS)
```

## Commands

### macOS

```bash
# Apply configuration changes
darwin-rebuild switch --flake ~/.dotfiles#popemkt-mac

# Or use the alias (after first rebuild)
rebuild
```

### Linux (NixOS)

```bash
# Apply configuration changes
sudo nixos-rebuild switch --flake ~/.dotfiles#nixos
```

### Both Platforms

```bash
# Update flake inputs
cd ~/.dotfiles && nix flake update

# Check flake validity
nix flake check
```

## Common Tasks

### Add a CLI tool (both platforms)
1. Edit `modules/shared/packages.nix` → `home.packages`
2. Run `rebuild`

### Add macOS-only package
1. Edit `modules/darwin/default.nix` → `home.packages`
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

## User Info

- **GitHub:** popemkt
- **Git name:** Hoang Nguyen Gia
- **Git email:** hoangng71299@gmail.com
- **System:** Apple Silicon Mac (aarch64-darwin)

## Notes

- Uses Determinate Nix installer (`nix.enable = false` in darwin config)
- `system.primaryUser = "popemkt"` required for user-specific settings
- `homebrew.onActivation.cleanup = "none"` - keeps unlisted apps
- Change to `"zap"` for strict reproducibility
- Touch ID for sudo: `security.pam.services.sudo_local.touchIdAuth`
- GUI app configs backed up via Mackup to iCloud (macOS only)

## Mackup (GUI App Settings)

```bash
# Backup GUI app settings to iCloud
mackup backup

# Restore on new machine
mackup restore
```

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
