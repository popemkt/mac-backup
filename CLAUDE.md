# Nix Dotfiles

Declarative macOS config: nix-darwin + home-manager + Homebrew + Mackup.

## Commands

```bash
rebuild                          # Apply changes (alias for darwin-rebuild switch)
cd ~/.dotfiles && nix flake update && rebuild  # Update all inputs
nix flake check                  # Validate flake
mackup backup / mackup restore   # GUI app settings via iCloud
```

## Where to Edit

| Want to...               | Edit                              |
|--------------------------|-----------------------------------|
| Add CLI tool             | `modules/shared/packages.nix`     |
| Add GUI app (cask)       | `hosts/darwin/default.nix` → `homebrew.casks` |
| Add brew formula         | `hosts/darwin/default.nix` → `homebrew.brews` |
| Add macOS system setting | `hosts/darwin/default.nix` → `system.defaults` |
| Add shell alias          | `modules/shared/shell.nix`        |
| Add macOS-only package   | `modules/darwin/default.nix`      |
| Change git config        | `modules/shared/git.nix`          |
| Add host-only config     | `hosts/<hostname>/default.nix`    |
| Add work/personal split  | `lib.mkIf (config.my.role == "work") { ... }` in any system module |

Then run `rebuild`.

## Lint & Format

Before suggesting commits, ensure changed `.nix` files pass:

```bash
nixfmt **/*.nix              # auto-format (RFC-166 style)
statix check .               # anti-pattern lint
deadnix --fail .             # unused bindings (exits non-zero)
nix flake check --no-build   # eval-time validation
```

Pre-commit hook at `.githooks/pre-commit` runs all four on staged files.
Activated via `git config core.hooksPath .githooks` (already set on this clone).

When adding new modules, prefer `_:` over `{ ... }:` if no args are used —
statix flags empty patterns. Use `{ pkgs, ... }:` only when actually
referencing `pkgs` in the body.

## Architecture

- `flake.nix` — entry point; `mkDarwin` builds one config per host (attr name = hostname)
- `modules/options/` — typed option declarations (`my.username`, `my.hostname`, `my.role`); read via `config.my.*` (system) or `osConfig.my.*` (home-manager) — no specialArgs
- `hosts/darwin/` — shared macOS base for ALL macs (nix-darwin settings, Homebrew, system defaults)
- `hosts/popemkt-work/` — work machine; `hosts/popemkt-personal/` — personal; each imports `../darwin` + sets `my.role` + host-only diffs
- Renaming a machine: rename host dir + flake attr, rebuild once with explicit `--flake ~/.dotfiles#<newname>` — activation sets HostName/ComputerName/LocalHostName via `networking.*`
- `modules/shared/` — cross-platform home-manager modules (shell, packages, git, neovim)
- `modules/darwin/` — macOS-specific home-manager (rebuild alias, brew helpers)
- `configs/` — raw config files (nvim, etc.)
- Platform conditionals: `lib.optionals pkgs.stdenv.isDarwin [...]` / `lib.mkIf pkgs.stdenv.isLinux { ... }`

## Gotchas

- Uses Determinate Nix installer → `nix.enable = false` in darwin config
- `system.primaryUser` comes from `config.my.username` (set in flake.nix)
- `homebrew.onActivation.cleanup = "none"` — keeps unlisted apps (change to `"zap"` for strict mode)
- Touch ID sudo: `security.pam.services.sudo_local.touchIdAuth`

## User

- **System:** Apple Silicon Mac (aarch64-darwin)
- **GitHub:** popemkt | **Name:** Hoang Nguyen Gia | **Email:** hoangng71299@gmail.com

## Commit Style

`<type>: <short description>` — types: feat, fix, docs, refactor, chore
