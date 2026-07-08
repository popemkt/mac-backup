# Dotfiles Implementation Bridge

Maps each functional area to the file, tool, and mechanism that implements it.
Update when responsibility moves, a new layer is added, or a known gap is closed.

Architecture decisions and rationale live in `../dotfiles-system.md`.
Operator procedure lives in `../../README.md`.

---

## Layer Ownership

| Functional area | Tool | Source file(s) |
|---|---|---|
| macOS system settings | nix-darwin | `hosts/darwin/default.nix` → `system.defaults` |
| Homebrew casks + brews | nix-darwin | `modules/darwin-system/homebrew.nix` → `homebrew` |
| Homebrew taps | nix-darwin | `modules/darwin-system/homebrew.nix` → `homebrew.taps` |
| launchd user agents | nix-darwin | focused modules under `modules/darwin-system/` |
| Global env vars (all apps) | nix-darwin | focused modules under `modules/darwin-system/` |
| CLI tools (nix packages) | home-manager | `modules/shared/packages.nix` |
| Shell config + aliases | home-manager | `modules/shared/shell.nix` |
| Git config | home-manager | `modules/shared/git.nix` |
| Neovim | home-manager | `modules/shared/neovim.nix` |
| npm global packages | home-manager | `modules/shared/npm-global.nix` |
| uv tool installs | home-manager activation | owning behavior modules, e.g. `modules/darwin-system/headroom.nix` |
| macOS-only aliases + rebuild | home-manager | `modules/darwin-home/default.nix` |
| External workspace + data symlinks | nix-darwin + home-manager | `modules/darwin-system/external-workspace.nix` |
| GUI app configs | Mackup → iCloud | `modules/darwin-home/mackup.nix` → `home.file.".mackup.cfg"` |
| Raw configs (specs, Archon) | git-tracked files | `configs/` |
| Flake inputs + entry point | Nix flake | `flake.nix` |

---

## Bootstrap Flow

| Functional step | Implementation |
|---|---|
| CLT install | `xcode-select --install` (manual, required by Homebrew) |
| Nix install | Determinate installer; `nix.enable = false` in darwin config so nix-darwin doesn't conflict |
| Homebrew install | standard Homebrew curl script |
| First nix-darwin apply | `sudo nix run nix-darwin -- switch --flake ~/.dotfiles#popemkt-mac` (darwin-rebuild not in PATH yet) |
| Subsequent rebuilds | `sudo darwin-rebuild switch --flake ~/.dotfiles#popemkt-mac` via `rebuild` alias |
| GUI config restore | `mackup restore` after iCloud Mackup folder syncs |

Rationale for `sudo` prefix: nix-darwin activation runs system-level scripts
requiring root since nix-darwin ≥ 2025. See `dotfiles-system.md`.

---

## CLI Tooling

| Functional need | Nix package | File |
|---|---|---|
| Version control | `git`, `gh` | `modules/shared/packages.nix` |
| File listing | `eza` | `modules/shared/packages.nix` |
| File viewing | `bat` | `modules/shared/packages.nix` |
| Python env manager | `uv` | `modules/shared/packages.nix` |
| Node version/env | via Homebrew brew or nix | — |
| Fuzzy finder | `fzf` | `modules/shared/packages.nix` |
| Git TUI | `lazygit` | `modules/shared/packages.nix` |
| Config sync | `mackup` | `modules/darwin-home/mackup.nix` |
| Rust toolchain | `rustc`, `cargo` | `modules/shared/packages.nix` |

---

## Shell

| Functional need | Implementation | File |
|---|---|---|
| Default shell | zsh via home-manager | `modules/shared/shell.nix` |
| Prompt | starship | `modules/shared/shell.nix` → `programs.starship` |
| Autosuggestions | zsh-autosuggestions | `modules/shared/shell.nix` |
| Syntax highlighting | zsh-syntax-highlighting | `modules/shared/shell.nix` |
| Aliases | `shellAliases` block | `modules/shared/shell.nix` |
| PATH additions | `initContent` | `modules/shared/shell.nix` |
| SDKROOT (C++ builds) | `xcrun --sdk macosx --show-sdk-path` export | `modules/shared/shell.nix` → `initContent` |
| NODE_OPTIONS | `--dns-result-order=ipv4first` | `modules/shared/shell.nix` → `initContent` |
| npmg helper | shell function | `modules/shared/shell.nix` → `initContent` |
| sysaudit alias | calls `scripts/audit-system-discrepancies.sh` | `modules/shared/shell.nix` |
| dump-login-items alias | calls `scripts/dump-login-items.sh` | `modules/shared/shell.nix` |
| rebuild alias | `sudo darwin-rebuild switch --flake ~/.dotfiles#${hostname}` | `modules/darwin-home/default.nix` |

---

## npm Globals

| Functional need | Package | File |
|---|---|---|
| Declared npm globals | `npmGlobalPackages` list | `modules/shared/npm-global.nix` |
| Install mechanism | home-manager activation `installNpmGlobals` | home-manager built-in |

Current tracked packages: `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`,
`@openai/codex`, `cline`, `gitnexus`, `portless`.

Known gap: `@tobilu/qmd`, `ccmanager`, `kanban`, `sudocode`, `yarn` installed
but not declared.

---

## uv Tools

| Functional need | Implementation | File |
|---|---|---|
| Tool declaration | `uvTools` list | `modules/darwin-system/headroom.nix` |
| Install mechanism | `home.activation.installHeadroomUvTools` runs on every rebuild | `modules/darwin-system/headroom.nix` |
| Idempotency | skips if `uv tool list` already shows the package | `modules/darwin-system/headroom.nix` |
| C++ build fix | `SDKROOT` set via `xcrun` before install loop | `modules/darwin-system/headroom.nix` |
| headroom-ai | `[all]` extras for the full Headroom toolset; pinned to nixpkgs Python during uv install | `modules/darwin-system/headroom.nix` |

Known gap: editable installs (`browser-harness`) are intentionally excluded —
they live in their own repos and can't be restored from a version string.

---

## Always-On Services

| Functional need | Implementation | File |
|---|---|---|
| headroom proxy daemon | `launchd.user.agents.headroom-proxy` | `modules/darwin-system/headroom.nix` |
| Binary path | `~/.local/bin/headroom` (installed by uv) | `modules/darwin-system/headroom.nix` |
| Proxy port | 8787, hardcoded in `ProgramArguments` and `HEADROOM_PORT` env var | `modules/darwin-system/headroom.nix` |
| Restart on failure | `KeepAlive = true` | `modules/darwin-system/headroom.nix` |
| Logs | `~/Library/Logs/headroom-proxy.{out,err}.log` | `modules/darwin-system/headroom.nix` |
| Env exposure | `HEADROOM_PROXY`, `HEADROOM_PORT` via `launchd.user.envVariables` | `modules/darwin-system/headroom.nix` |

---

## GUI App Config Sync (Mackup)

| Functional need | Implementation | File |
|---|---|---|
| Mackup config file | managed by home-manager as `home.file.".mackup.cfg"` | `modules/darwin-home/mackup.nix` |
| Storage backend | iCloud (`engine = icloud`) | `modules/darwin-home/mackup.nix` |
| Allowlist | explicit `[applications_to_sync]` block | `modules/darwin-home/mackup.nix` |
| Backup command | `mackup backup --force` | documented in README |
| Restore command | `mackup restore` | documented in README |

Rationale for explicit allowlist: implicit backup synced credential files to
iCloud on first run. See `dotfiles-system.md`.

---

## macOS System Settings

| Functional need | Implementation | File |
|---|---|---|
| Dock autohide | `system.defaults.dock.autohide` | `hosts/darwin/default.nix` |
| Finder path/status bar | `system.defaults.finder.*` | `hosts/darwin/default.nix` |
| Tap to click | `system.defaults.trackpad.Clicking` | `hosts/darwin/default.nix` |
| Key repeat speed | `NSGlobalDomain.KeyRepeat`, `InitialKeyRepeat` | `hosts/darwin/default.nix` |
| Touch ID sudo | `security.pam.services.sudo_local.touchIdAuth` | `hosts/darwin/default.nix` |
| /stuff symlink | `system.activationScripts.extraActivation` | `modules/darwin-system/external-workspace.nix` |

---

## Auditing and Drift Detection

| Functional need | Implementation | File |
|---|---|---|
| Homebrew drift | compares declared vs installed casks/brews | `scripts/audit-system-discrepancies.sh` |
| npm global drift | compares `npmGlobalPackages` vs `npm ls -g` | `scripts/audit-system-discrepancies.sh` |
| uv tool drift | compares `uvTools` vs `uv tool list` (skips editable) | `scripts/audit-system-discrepancies.sh` |
| Login items snapshot | osascript dump to `configs/login-items.txt` | `scripts/dump-login-items.sh` |

---

## Pre-commit Validation

| Check | Tool | Scope |
|---|---|---|
| Format | nixfmt | staged `.nix` files |
| Anti-patterns | statix | whole repo |
| Dead bindings | deadnix | whole repo |
| Eval-time errors | `nix flake check --no-build` | whole flake |

Hook location: `.githooks/pre-commit`. Activated via `git config core.hooksPath .githooks`.

---

## Known Gaps

| Functional intent | Gap | Gap location |
|---|---|---|
| All npm globals tracked | `@tobilu/qmd`, `ccmanager`, `kanban`, `sudocode`, `yarn` missing | `modules/shared/npm-global.nix` |
| All repo-owned uv tools tracked | editable tools are excluded by design | owning behavior modules |
| Hermes agent launchd | plist is manual deploy, hardcodes `/Volumes/Data` | `README.md` manual steps |
| `~/.local/bin` scripts | `hermes`, `iii`, `plannotator` depend on `/stuff` workspace | not in repo |
| Full gitconfig | `nbstripout`, `agor safe.directory` not in `git.nix` | `modules/shared/git.nix` |
| Login item restore | no programmatic API on macOS 13+ | manual |
| Full Xcode | CLT-only; SDKROOT workaround active | `modules/darwin-system/headroom.nix`, `shell.nix` |
