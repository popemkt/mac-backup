# Dotfiles System Spec

Source of truth for architecture decisions, layer ownership, and restore
procedure. README.md is the operator manual; this doc is the *why*.

---

## Principle

Declarative > imperative. Every reproducible setting lives in a file.
Manual steps exist only where tooling has no solution (credentials, editable
installs, App Store exclusives).

---

## Layer Map

| Layer | Tool | Owns | Source |
|---|---|---|---|
| System config | nix-darwin | macOS settings, launchd agents | `hosts/darwin/default.nix` |
| Homebrew config | nix-darwin | Homebrew taps, brews, casks, MAS apps | `modules/darwin-system/homebrew.nix` |
| User environment | home-manager | CLI tools, shell, git, neovim, starship, npm globals | `modules/shared/` + `modules/darwin-home/` |
| Behavior modules | nix-darwin + home-manager | Headroom, Hermes, external workspace, input sources | `modules/darwin-system/` |
| GUI app configs | Mackup → iCloud | Karabiner, Zed, VS Code, Warp, AltTab, Telegram, Claude Code, macOS shortcuts | `~/.mackup.cfg` allowlist |
| Raw configs | `configs/` | Raycast export, login items snapshot, specs, Archon workflows | manual import on restore |
| Manual | — | SSH keys, credentials, Hermes plist, editable uv tools | per-restore checklist |

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

### Single flake entry for now
One `darwinConfigurations."popemkt-mac"` entry. A second machine can be added
by duplicating the entry with a new hostname. Both start identical; diverge via
`if hostname ==` conditionals or separate host modules. No upfront split needed.

### uv tools declared with their owning behavior
`uv tool install` runs during home-manager activation (`home.activation`). Nix
can't package arbitrary PyPI wheels, so the declaration is a manifest of intent,
not a hermetic derivation. Repo-owned tools live with the behavior that needs
them, for example Headroom in `modules/darwin-system/headroom.nix`.
Editable/local installs (browser-harness, etc.) are intentionally excluded —
they belong to their own repos.

### SDKROOT workaround for C++ Python extensions
CLT-only macOS doesn't set `SDKROOT`; clang can't find `<iostream>` etc.
Set via `xcrun --sdk macosx --show-sdk-path` in both the activation script and
interactive shell. Full Xcode (App Store) sets this automatically and is the
preferred long-term fix.

### darwin-rebuild requires sudo (nix-darwin ≥ 2025)
Activation now runs system-level scripts that require root. All rebuild
invocations are prefixed with `sudo`. The `rebuild` alias in
`modules/darwin-home/default.nix` reflects this.

### First bootstrap uses `nix run nix-darwin`, not `darwin-rebuild`
`darwin-rebuild` is not in PATH until nix-darwin is installed. Bootstrap command:
`sudo nix run nix-darwin -- switch --flake ~/.dotfiles#popemkt-mac`.

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
5. `sudo scutil --set HostName popemkt-mac`
6. `sudo nix run nix-darwin -- switch --flake ~/.dotfiles#popemkt-mac`
7. Restart terminal
8. Sign into iCloud, wait for Mackup folder to sync
9. `mackup restore`
10. Manual: SSH keys, `gh auth login`, `az login`, `gcloud auth login`,
    Tailscale, Raycast import, Hermes plist

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
