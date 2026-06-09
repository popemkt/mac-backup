# dotfiles

Declarative macOS setup: **nix-darwin** + **home-manager** + **Homebrew** + **Mackup**.

## New Machine Restore

### 1. Prerequisites

```bash
# Install Determinate Nix
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Clone & build

```bash
git clone git@github.com:popemkt/mac-backup.git ~/.dotfiles
cd ~/.dotfiles
git config core.hooksPath .githooks

# Set machine hostname to match flake (or add a new config — see below)
sudo scutil --set HostName popemkt-mac
sudo scutil --set ComputerName popemkt-mac

darwin-rebuild switch --flake ~/.dotfiles#popemkt-mac
```

Restart terminal after first build.

### 3. Restore GUI app settings (Mackup)

Requires iCloud to be signed in and syncing.

```bash
mackup restore
```

This restores: Karabiner-Elements, Zed, VS Code, Raycast, and other supported apps.

### 4. Manual steps (not automated)

| Item | Action |
|------|--------|
| **SSH keys** | Copy from old machine or generate new. No keys tracked in repo. |
| **Git credentials** | `gh auth login` → re-authenticates GitHub CLI + credential manager |
| **Azure credentials** | `az login` |
| **GCP credentials** | `gcloud auth login` |
| **Tailscale** | Sign in via menu bar |
| **Hermes agent** | See below |
| **uv tools** | `uvx install browser-harness cognee mempalace` |
| **/stuff workspace** | Mount or attach `/Volumes/Data` external drive, or update `HERMES_HOME` path |

#### Hermes agent (launchd)

The hermes gateway plist is not managed by nix. After setting up the hermes repo:

```bash
cp ~/.hermes/hermes-agent/ai.hermes.gateway-popemkt.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.hermes.gateway-popemkt.plist
```

Note: plist hardcodes `/Volumes/Data/...` for `HERMES_HOME` — update to match actual path if drive name differs.

---

## Daily Usage

```bash
rebuild                                    # apply config changes
cd ~/.dotfiles && nix flake update && rebuild  # update all inputs
mackup backup                              # sync GUI app settings to iCloud
```

## Where to Edit

| Want to... | Edit |
|------------|------|
| Add CLI tool | `modules/shared/packages.nix` |
| Add GUI app (cask) | `hosts/darwin/default.nix` → `homebrew.casks` |
| Add brew formula | `hosts/darwin/default.nix` → `homebrew.brews` |
| Add macOS system setting | `hosts/darwin/default.nix` → `system.defaults` |
| Add shell alias | `modules/shared/shell.nix` |
| Add macOS-only package | `modules/darwin/default.nix` |
| Change git config | `modules/shared/git.nix` |
| Add npm global | `modules/shared/npm-global.nix` |

## What's Managed Where

| Layer | Manages | Source of truth |
|-------|---------|-----------------|
| **nix-darwin** | macOS system settings, Homebrew declaration | `hosts/darwin/default.nix` |
| **home-manager** | CLI tools, shell, git, neovim, starship | `modules/shared/` |
| **Mackup → iCloud** | GUI app configs (Karabiner, Zed, Raycast, etc.) | `~/iCloud/Mackup/` |
| **npm-global.nix** | npm global CLIs | `modules/shared/npm-global.nix` |
| **Manual** | SSH keys, credentials, Hermes, uv tools | — |

## Adding a Second Machine

Add a new config block in `flake.nix`:

```nix
darwinConfigurations."new-hostname" = nix-darwin.lib.darwinSystem {
  system = "aarch64-darwin"; # or x86_64-darwin for Intel
  specialArgs = { username = "popemkt"; hostname = "new-hostname"; };
  modules = [ ... ]; # same as existing config
};
```

Then on new machine: `darwin-rebuild switch --flake ~/.dotfiles#new-hostname`

## Lint & Format

```bash
nixfmt **/*.nix          # format
statix check .           # lint anti-patterns
deadnix --fail .         # find unused bindings
nix flake check --no-build
```

Pre-commit hook at `.githooks/pre-commit` runs all four on staged `.nix` files.
Already activated on this clone via `git config core.hooksPath .githooks`.

## Known Gaps (not fully automated)

- npm globals not yet in `npm-global.nix`: `@tobilu/qmd`, `ccmanager`, `kanban`, `sudocode`, `yarn`
- uv tools (`browser-harness`, `cognee`, `mempalace`) — install via `uvx install`
- Hermes launchd plist — manual deploy
- Custom `~/.local/bin` scripts (`hermes`, `iii`, `plannotator`) — depend on `/stuff` workspace
- `~/.gitconfig` has extra entries (nbstripout, agor safe.directory) not in `git.nix`
- Git nbstripout filter hardcodes `/Volumes/Data/...` path — update after restore if needed
