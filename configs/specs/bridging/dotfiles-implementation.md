# Dotfiles Implementation Bridge

Maps each functional area to the file, tool, and mechanism that implements it.
Update when responsibility moves, a new layer is added, or a known gap is closed.

Architecture decisions and rationale live in `../dotfiles-system.md`.
Operator procedure lives in `../../README.md`.

---

## Layer Ownership

| Functional area | Tool | Source file(s) |
|---|---|---|
| macOS system settings | nix-darwin | `modules/darwin/system/default.nix` → `system.defaults` |
| Homebrew casks + brews | nix-darwin | `modules/darwin/system/homebrew.nix` → `homebrew` |
| Homebrew taps | nix-darwin | `modules/darwin/system/homebrew.nix` → `homebrew.taps` |
| launchd user agents | nix-darwin | focused modules under `modules/darwin/system/` |
| Global env vars (all apps) | nix-darwin | focused modules under `modules/darwin/system/` |
| CLI tools (nix packages) | home-manager | `modules/common/home-manager/packages.nix` |
| Shell config + aliases | home-manager | `modules/common/home-manager/shell.nix` |
| Git config | home-manager | `modules/common/home-manager/git.nix` |
| Neovim | home-manager | `modules/common/home-manager/neovim.nix` |
| npm global packages | home-manager | `modules/common/home-manager/npm-global.nix` |
| Bun global packages | macOS home-manager | `modules/darwin/home-manager/bun-global.nix` |
| uv tool installs | home-manager activation | owning behavior modules, e.g. `modules/darwin/system/headroom.nix` |
| Direct release packages | nvfetcher + local Nix packages | `nvfetcher.toml`, `_sources/`, `pkgs/` |
| macOS-only shell helpers + rebuild | home-manager | `modules/darwin/home-manager/default.nix` |
| External workspace + data symlinks | nix-darwin + home-manager | `modules/darwin/system/external-workspace.nix` |
| Private app exposure | Tailscale Services + nix-darwin | `modules/darwin/system/tailscale-services.nix` + `hosts/<hostname>/default.nix` |
| GUI app configs | Mackup → iCloud | `modules/darwin/home-manager/mackup.nix` → `home.file.".mackup.cfg"` |
| Raw configs (specs, Archon) | git-tracked files | `configs/` |
| Flake inputs + entry point | Nix flake | `flake.nix` |

---

## Bootstrap Flow

| Functional step | Implementation |
|---|---|
| CLT install | `xcode-select --install` (manual, required by Homebrew) |
| Nix install | Determinate installer; `nix.enable = false` in darwin config so nix-darwin doesn't conflict |
| Homebrew install | standard Homebrew curl script |
| First nix-darwin apply | `sudo nix run nix-darwin -- switch --flake ~/.dotfiles#popemkt-personal` (darwin-rebuild not in PATH yet) |
| Subsequent rebuilds | best-effort release check, then `sudo darwin-rebuild switch --flake ~/.dotfiles` via `rebuild` |
| GUI config restore | `mackup restore` after iCloud Mackup folder syncs |

Rationale for `sudo` prefix: nix-darwin activation runs system-level scripts
requiring root since nix-darwin ≥ 2025. See `dotfiles-system.md`.

---

## CLI Tooling

| Functional need | Nix package | File |
|---|---|---|
| Version control | `git`, `gh` | `modules/common/home-manager/packages.nix` |
| File listing | `eza` | `modules/common/home-manager/packages.nix` |
| File viewing | `bat` | `modules/common/home-manager/packages.nix` |
| Python env manager | `uv` | `modules/common/home-manager/packages.nix` |
| Node runtime | `nodejs` via Nix | `modules/common/home-manager/packages.nix` |
| Bun runtime | `bun` via Homebrew | `modules/darwin/system/homebrew.nix` |
| Fuzzy finder | `fzf` | `modules/common/home-manager/packages.nix` |
| Git TUI | `lazygit` | `modules/common/home-manager/packages.nix` |
| Config sync | `mackup` | `modules/darwin/home-manager/mackup.nix` |
| Rust toolchain | `rustc`, `cargo` | `modules/common/home-manager/packages.nix` |
| OAuth API proxy | `cli-proxy-api` | `pkgs/cli-proxy-api`, `modules/darwin/system/cli-proxy-api.nix` |
| Cursor terminal agent | `cursor-cli` pinned official archive | `pkgs/cursor-cli`, `modules/common/home-manager/packages.nix` |

---

## Shell

| Functional need | Implementation | File |
|---|---|---|
| Default shell | zsh via home-manager | `modules/common/home-manager/shell.nix` |
| Prompt | starship | `modules/common/home-manager/shell.nix` → `programs.starship` |
| Autosuggestions | zsh-autosuggestions | `modules/common/home-manager/shell.nix` |
| Syntax highlighting | zsh-syntax-highlighting | `modules/common/home-manager/shell.nix` |
| Aliases | `shellAliases` block | `modules/common/home-manager/shell.nix` |
| PATH additions | `initContent` | `modules/common/home-manager/shell.nix` |
| SDKROOT (C++ builds) | `xcrun --sdk macosx --show-sdk-path` export | `modules/darwin/home-manager/default.nix` → `initContent` |
| NODE_OPTIONS | `--dns-result-order=ipv4first` | `modules/darwin/home-manager/default.nix` → `initContent` |
| npmg helper | shell function | `modules/common/home-manager/shell.nix` → `initContent` |
| sysaudit alias | calls `scripts/audit-system-discrepancies.sh` | `modules/common/home-manager/shell.nix` |
| dump-login-items alias | calls `scripts/dump-login-items.sh` | `modules/common/home-manager/shell.nix` |
| rebuild helper | best-effort release check, pinned `darwin-rebuild`, then drift audit | `modules/darwin/home-manager/default.nix` |

---

## JavaScript Globals

| Functional need | Package | File |
|---|---|---|
| Declared npm globals | `npmGlobalPackages` list | `modules/common/home-manager/npm-global.nix` |
| npm install/upgrade | home-manager activation `installNpmGlobals` | `modules/common/home-manager/npm-global.nix` |
| Declared Bun globals | `bunGlobalPackages` list | `modules/darwin/home-manager/bun-global.nix` |
| Bun install/upgrade | home-manager activation `installBunGlobals` | `modules/darwin/home-manager/bun-global.nix` |

Current tracked packages: `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`,
`@openai/codex`, `cline`, `gitnexus`, `portless`.

Current tracked Bun package: `@oh-my-pi/pi-coding-agent`.

Rebuild installs missing declarations and upgrades existing npm/Bun globals to
the latest registry version. An unavailable registry warns and preserves an
already-installed version; a missing package still fails activation.

Known gap: `@tobilu/qmd`, `ccmanager`, `kanban`, `sudocode`, `yarn` installed
but not declared.

---

## uv Tools

| Functional need | Implementation | File |
|---|---|---|
| Tool declaration | `uvTools` list | `modules/darwin/system/headroom.nix` |
| Install mechanism | `home.activation.installHeadroomUvTools` runs on every rebuild | `modules/darwin/system/headroom.nix` |
| Idempotency | skips if `uv tool list` already shows the package | `modules/darwin/system/headroom.nix` |
| C++ build fix | `SDKROOT` set via `xcrun` before install loop | `modules/darwin/system/headroom.nix` |
| headroom-ai | `[all]` extras for the full Headroom toolset; pinned to nixpkgs Python during uv install | `modules/darwin/system/headroom.nix` |

Known gap: editable installs (`browser-harness`) are intentionally excluded —
they live in their own repos and can't be restored from a version string.

---

## Always-On Services

| Functional need | Implementation | File |
|---|---|---|
| headroom proxy daemon | `launchd.user.agents.headroom-proxy` | `modules/darwin/system/headroom.nix` |
| Binary path | `~/.local/bin/headroom` (installed by uv) | `modules/darwin/system/headroom.nix` |
| Proxy port | 8787, hardcoded in `ProgramArguments` and `HEADROOM_PORT` env var | `modules/darwin/system/headroom.nix` |
| Restart on failure | `KeepAlive = true` | `modules/darwin/system/headroom.nix` |
| Logs | `~/Library/Logs/headroom-proxy.{out,err}.log` | `modules/darwin/system/headroom.nix` |
| Env exposure | `HEADROOM_PROXY`, `HEADROOM_PORT` via `launchd.user.envVariables` | `modules/darwin/system/headroom.nix` |
| CLIProxyAPI daemon | `launchd.user.agents.cli-proxy-api` | `modules/darwin/system/cli-proxy-api.nix` |
| CLIProxyAPI endpoint | loopback-only `127.0.0.1:8317` | `modules/darwin/system/cli-proxy-api.nix` |
| CLIProxyAPI local trust boundary | no API key; all processes able to reach loopback are trusted | explicit single-user workstation policy |
| CLIProxyAPI auth state | mutable `~/.local/share/cli-proxy-api` | secure backup or provider re-login |
| CLIProxyAPI restart policy | retry unsuccessful exits, throttled to 30 seconds | `KeepAlive.SuccessfulExit = false` |
| CLIProxyAPI logs | `~/Library/Logs/cli-proxy-api.{out,err}.log` | `modules/darwin/system/cli-proxy-api.nix` |
| `claudex` command | Zsh function with process-scoped Sol and CLIProxyAPI environment | `modules/darwin/home-manager/default.nix` |
| Tailscale Service reconciliation | root launchd daemon after Tailscale is online | `modules/darwin/system/tailscale-services.nix` |
| Tailscale Service declarations | typed `my.stacks.vpn.services` host inventory | `modules/stacks/vpn/default.nix`, `hosts/<hostname>/default.nix` |

---

## Private App Exposure

| Functional need | Implementation | File |
|---|---|---|
| Stable service identity | attribute name becomes `svc:<name>` | host `my.stacks.vpn.services` declaration |
| HTTPS and TailVIP endpoint | generated `tailscale serve --service` invocation | `modules/darwin/system/tailscale-services.nix` |
| Local app isolation | target must resolve to `127.0.0.1` or `localhost` | module assertion |
| Removed-service cleanup | root-owned managed-service inventory under `/var/db` | module launchd implementation |
| Network authorization | Tailscale grant targeting `svc:<name>` | tailnet policy |
| Application authentication | implemented by the app | owning app repository |
| App runtime contract | build, config, state, secret, and deployment ownership rules | `configs/specs/app-service-contract.md` |

---

## GUI App Config Sync (Mackup)

| Functional need | Implementation | File |
|---|---|---|
| Mackup config file | managed by home-manager as `home.file.".mackup.cfg"` | `modules/darwin/home-manager/mackup.nix` |
| Storage backend | iCloud (`engine = icloud`) | `modules/darwin/home-manager/mackup.nix` |
| Allowlist | explicit `[applications_to_sync]` block | `modules/darwin/home-manager/mackup.nix` |
| Backup command | `mackup backup --force` | documented in README |
| Restore command | `mackup restore` | documented in README |

Rationale for explicit allowlist: implicit backup synced credential files to
iCloud on first run. See `dotfiles-system.md`.

---

## macOS System Settings

| Functional need | Implementation | File |
|---|---|---|
| Dock autohide | `system.defaults.dock.autohide` | `modules/darwin/system/default.nix` |
| Finder path/status bar | `system.defaults.finder.*` | `modules/darwin/system/default.nix` |
| Tap to click | `system.defaults.trackpad.Clicking` | `modules/darwin/system/default.nix` |
| Key repeat speed | `NSGlobalDomain.KeyRepeat`, `InitialKeyRepeat` | `modules/darwin/system/default.nix` |
| Touch ID sudo | `security.pam.services.sudo_local.touchIdAuth` | `modules/darwin/system/default.nix` |
| /stuff symlink | `system.activationScripts.extraActivation` | `modules/darwin/system/external-workspace.nix` |

---

## Auditing and Drift Detection

| Functional need | Implementation | File |
|---|---|---|
| Homebrew drift | compares declared vs installed casks/brews | `scripts/audit-system-discrepancies.sh` |
| npm global drift | compares `npmGlobalPackages` vs `npm ls -g` | `scripts/audit-system-discrepancies.sh` |
| Bun global drift | compares `bunGlobalPackages` vs Bun's global manifest | `scripts/audit-system-discrepancies.sh` |
| uv tool drift | compares `uvTools` vs `uv tool list` (skips editable) | `scripts/audit-system-discrepancies.sh` |
| Login items snapshot | osascript dump to `configs/login-items.txt` | `scripts/dump-login-items.sh` |
| Direct release freshness | best-effort remote comparison; no mutation | `scripts/github-sources check` |
| Direct release update | nvfetcher regenerates pinned versions and hashes | `scripts/github-sources update` |

---

## Pre-commit Validation

| Check | Tool | Scope |
|---|---|---|
| Format | nixfmt | staged `.nix` files |
| Anti-patterns | statix | whole repo |
| Dead bindings | deadnix | whole repo except generated nvfetcher output |
| Eval-time errors | `nix flake check --no-build` | whole flake |
| Release freshness | GitHub API and upstream webpages through `github-sources` | best effort; offline passes, stale source changes block |
| Generated source consistency | nvfetcher regeneration in a temporary directory | staged snapshot locally; authoritative in PR CI |

Hook location: `.githooks/pre-commit`. Activated via `git config core.hooksPath .githooks`.

---

## Known Gaps

| Functional intent | Gap | Gap location |
|---|---|---|
| All npm globals tracked | `@tobilu/qmd`, `ccmanager`, `kanban`, `sudocode`, `yarn` missing | `modules/common/home-manager/npm-global.nix` |
| All repo-owned uv tools tracked | editable tools are excluded by design | owning behavior modules |
| Hermes agent launchd | plist is manual deploy, hardcodes `/Volumes/Data` | `README.md` manual steps |
| `~/.local/bin` scripts | `hermes`, `iii`, `plannotator` depend on `/stuff` workspace | not in repo |
| Full gitconfig | `nbstripout`, `agor safe.directory` not in `git.nix` | `modules/common/home-manager/git.nix` |
| Login item restore | no programmatic API on macOS 13+ | manual |
| Full Xcode | CLT-only; SDKROOT workaround active | `modules/darwin/system/headroom.nix`, `modules/darwin/home-manager/default.nix` |
