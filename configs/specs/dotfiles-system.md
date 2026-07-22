# Dotfiles System Spec

Source of truth for architecture decisions, layer ownership, and restore
procedure. README.md is the operator manual; this doc is the *why*.

---

## Principle

Declarative > imperative. Every reproducible setting lives in a file.
Interactive steps exist only where a person or third-party authorization
boundary is unavoidable. Their intent, dependencies, checks, and recovery are
still declared and surfaced by `system-setup`.

---

## Layer Map

| Layer | Tool | Owns | Source |
|---|---|---|---|
| System config | nix-darwin | macOS settings, launchd agents | `modules/darwin/system/default.nix` |
| Homebrew config | nix-darwin | Homebrew taps, brews, casks, MAS apps | `modules/darwin/system/homebrew.nix` |
| User environment | home-manager | CLI tools, shell, git, neovim, starship, npm/Bun globals | `modules/common/home-manager/` + `modules/darwin/home-manager/` |
| Direct release packages | nvfetcher + Nix | upstream versions, assets, and hashes | `nvfetcher.toml` + `_sources/` + `pkgs/` |
| Behavior modules | nix-darwin + home-manager | Headroom, CLIProxyAPI, Hermes, external workspace, input sources | `modules/darwin/system/` |
| External enrollment | Nix-built Python application | OAuth, device identity, SaaS approvals, generated keys, readiness | `modules/darwin/system/system-setup.nix` |
| Private service exposure | Tailscale Services + nix-darwin | stable service identities, TailVIP endpoints, HTTPS termination | `modules/darwin/system/tailscale-services.nix` + host declarations |
| GUI app configs | Mackup → iCloud | Karabiner, Zed, VS Code, Warp, AltTab, Telegram, Claude Code, macOS shortcuts | `~/.mackup.cfg` allowlist |
| Raw configs | `configs/` | Raycast export, login items snapshot, specs, Archon workflows | manual import on restore |
| Manual | — | SSH keys, standalone app sign-ins, Hermes plist, editable uv tools | per-restore checklist |

---

## Key Decisions

### Determinate Nix over nixpkgs Nix
Determinate installer manages `/nix` as a separate APFS volume — cleaner
uninstall, no `/etc/synthetic.conf` wrestling. Consequence: `nix.enable = false`
in nix-darwin (nix-darwin must not try to manage what Determinate already owns).

### home-manager does not own GUI app configs
`home.file` creates read-only nix store symlinks. Apps that write back to their
own config (Karabiner, Zed, VS Code) would break — they can't write through a
read-only symlink. Mackup instead: symlinks configs to iCloud Drive, apps write
through normally.

### Mackup allowlist is explicit, not implicit
First `mackup backup` without an allowlist backed up credentials (`.azure`,
`.kube/config`, `.config/gh`, `.codex/auth.json`) to iCloud. Fixed by explicit
`[applications_to_sync]` in `.mackup.cfg`. Rule: never add an app to the
allowlist without verifying it doesn't store secrets.

### Homebrew cleanup = "none"
`onActivation.cleanup = "zap"` removes any cask not in the list — too
aggressive while config is evolving. Switch to `"zap"` when the cask list
stabilises.

### Shared modules, explicit host composition
Each Darwin host has a `hosts/<hostname>/default.nix` entry composed through the
shared `mkDarwin` helper. Shared behavior belongs in modules; host files declare
only role and host-specific differences. The configured hostname must match its
`darwinConfigurations` attribute. Current hosts are `popemkt-personal` and
`popemkt-work`.

### Tailscale Services own private app exposure
Apps listen on loopback and opt into exposure through a host declaration under
`my.stacks.vpn.services`. Each declaration becomes a separate Tailscale
Service identity and TailVIP. The nix-darwin module owns host-side reconciliation;
Tailscale grants own network authorization, while the app still owns application
authentication. See `app-service-contract.md`.

### Cognee is centralized, with thin per-machine clients
`popemkt-personal` is the only Cognee state and processing host. Tailnet Macs
connect to its authenticated HTTPS origin; their local `cognee-mcp` processes
are secret-holding protocol bridges, not databases. Each device has a revocable
API key. Work data uses its own dataset for normal recall and a separate Cognee
user whenever a true authorization boundary is required. Mutable knowledge,
credentials, and databases remain backup concerns rather than repo content.

### uv tools declared with their owning behavior
`uv tool install` runs during home-manager activation (`home.activation`). Nix
can't package arbitrary PyPI wheels, so the declaration is a manifest of intent,
not a hermetic derivation. Repo-owned tools live with the behavior that needs
them, for example Headroom in `modules/stacks/ai-agents/headroom.nix`.
Editable/local installs (browser-harness, etc.) are intentionally excluded —
they belong to their own repos.

### External requirements are declarations too
Nix cannot complete an OAuth consent screen, approve a host in a SaaS control
plane, or own provider-issued credential state. It does build `system-setup`
hermetically and generate its strict per-host manifest. The application turns
those remaining requirements into a dependency graph with read-only checks,
explicit enrollment commands, secret-state locations, and recovery guidance.
Routine rebuilds report status but never start an enrollment ceremony. See
`docs/system-setup.md`.

### JavaScript globals have an explicit update boundary
npm and Bun global package lists are declarations of intent rather than
hermetic Nix derivations. Home Manager restores missing declarations during a
routine rebuild; `apply-system-update` asks each owning registry for the latest
declared version after activating prepared pins. Bun itself is owned by Homebrew
because Oh My Pi needs a newer runtime than the current nixpkgs package.

### Direct releases use nvfetcher
Applications distributed as direct release assets are declared once in
`nvfetcher.toml`; versions may come from GitHub releases or an upstream webpage.
Generated versions and hashes are committed under `_sources/`, while package
recipes live under `pkgs/`. Pre-commit checks freshness when online, validates
the exact staged snapshot, and never mutates files; offline release checks pass.
Updates remain explicit or arrive as an automatically merged pull request every
two days. `rebuild` consumes pins without version discovery; `update-system`
prepares and validates repository pin changes; `apply-system-update` mutates the
live system, audits it, then commits and pushes only `flake.lock` and `_sources/`.
A cold Nix store may still need to download missing pinned artifacts.

### SDKROOT workaround for C++ Python extensions
CLT-only macOS doesn't set `SDKROOT`; clang can't find `<iostream>` etc.
Set via `xcrun --sdk macosx --show-sdk-path` in both the activation script and
interactive shell. Full Xcode (App Store) sets this automatically and is the
preferred long-term fix.

### darwin-rebuild requires sudo (nix-darwin ≥ 2025)
Activation now runs system-level scripts that require root. All rebuild
invocations are prefixed with `sudo`. The `rebuild` shell function in
`modules/darwin/home-manager/default.nix` reflects this.

### First bootstrap uses `nix run nix-darwin`, not `darwin-rebuild`
`darwin-rebuild` is not in PATH until nix-darwin is installed. Bootstrap command:
`sudo nix run nix-darwin -- switch --flake ~/.dotfiles#popemkt-personal`.

---

## Managed App Config Allowlist

Apps in Mackup sync (`.mackup.cfg`):

| App | Why tracked |
|---|---|
| alt-tab | window switcher layout + shortcuts |
| karabiner-elements | keyboard remapping rules |
| warp | terminal themes, keybindings, workflows |
| zed | editor settings, keybindings, extensions |
| vscode | settings, keybindings, snippets |
| telegram_macos | account-independent UI prefs |
| claude-code | settings.json (MCP servers, hooks, preferences) |
| macosx | global keyboard shortcuts |

Deliberately excluded: anything storing credentials or tokens.

---

## Restore Sequence

1. `xcode-select --install` (CLT — required by Homebrew)
2. Install Determinate Nix, restart terminal
3. Install Homebrew
4. `git clone https://github.com/popemkt/mac-backup.git ~/.dotfiles`
5. `sudo scutil --set HostName popemkt-personal`
6. `sudo nix run nix-darwin -- switch --flake ~/.dotfiles#popemkt-personal`
7. Restart terminal
8. Sign into iCloud, wait for Mackup folder to sync
9. `mackup restore`
10. Run `system-setup next` until `system-setup verify` succeeds
11. Manual: SSH keys, `gh auth login`, `az login`, `gcloud auth login`,
    Raycast import, standalone app sign-ins, Hermes plist

---

## Known Gaps

- npm globals not in `npm-global.nix`: `@tobilu/qmd`, `ccmanager`, `kanban`,
  `sudocode`, `yarn`
- uv editable tools not tracked: `browser-harness` (lives in its own repo)
- Hermes launchd plist — manual deploy; hardcodes `/Volumes/Data` path
- `~/.local/bin` scripts (`hermes`, `iii`, `plannotator`) — depend on
  `/stuff` workspace, not in repo
- `~/.gitconfig` extras (nbstripout, agor safe.directory) not in `git.nix`
- Login items backed up to `configs/login-items.txt` via `dump-login-items`
  alias but not auto-restored (no programmatic Login Items API on macOS 13+)
- Full Xcode not installed — using `SDKROOT` xcrun workaround instead
