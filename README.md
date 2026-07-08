# dotfiles

Declarative macOS setup: **nix-darwin** + **home-manager** + **Homebrew** + **Mackup**.

## New Machine Restore

> Before starting: run `mackup backup` on the old machine to push latest settings to iCloud.

### 1. Prerequisites

```bash
# Xcode CLI tools (required by Homebrew)
xcode-select --install

# Install Determinate Nix (restart terminal after)
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Clone & build

Must clone to `~/.dotfiles` — the flake and rebuild alias hardcode this path.

```bash
# Use HTTPS if SSH key not set up yet
git clone https://github.com/popemkt/mac-backup.git ~/.dotfiles
cd ~/.dotfiles
git config core.hooksPath .githooks

# Match hostname to flake config
sudo scutil --set HostName popemkt-mac
sudo scutil --set ComputerName popemkt-mac

# First time only — darwin-rebuild not in PATH yet
sudo nix run nix-darwin -- switch --flake ~/.dotfiles#popemkt-mac

# Subsequent rebuilds
sudo darwin-rebuild switch --flake ~/.dotfiles#popemkt-mac
```

Restart terminal after first build.

### 3. Restore GUI app settings (Mackup)

Sign into iCloud first and wait for Mackup folder to sync, then:

```bash
mackup restore
```

Restores: AltTab, Karabiner-Elements, Zed, VS Code, Warp, Telegram, Claude Code, macOS keyboard shortcuts.

### 4. Manual steps

| Item | Action |
|------|--------|
| **SSH keys** | Copy from old machine or generate new — no keys tracked in repo |
| **Git credentials** | `gh auth login` |
| **Azure** | `az login` |
| **GCP** | `gcloud auth login` |
| **Tailscale** | Sign in via menu bar |
| **Raycast** | `open ~/.dotfiles/configs/raycast.rayconfig` → click Import |
| **Editable/local uv tools** | Install from their owning repos if needed; repo-tracked uv tools are installed during rebuild |
| **Archon CLI** | Managed by Homebrew; verify with `archon workflow list` |
| **App sign-ins** | Claude, Discord, Warp, Lens — manual |
| **/stuff workspace** | Attach `/Volumes/Data` external drive, or update `modules/darwin-system/external-workspace.nix` and `modules/darwin-system/hermes.nix` |

#### Hermes agent (optional)

Not managed by nix. After cloning the hermes repo:

```bash
cp ~/.hermes/hermes-agent/ai.hermes.gateway-popemkt.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/ai.hermes.gateway-popemkt.plist
```

Plist hardcodes `HERMES_HOME=/Volumes/Data/...` — update if drive name differs.

#### SSH: switch from HTTPS to SSH after key setup

```bash
cd ~/.dotfiles
git remote set-url origin git@github.com:popemkt/mac-backup.git
```

---

## Daily Usage

```bash
rebuild                                         # apply config changes
cd ~/.dotfiles && nix flake update && rebuild   # update all inputs
mackup backup --force                            # sync GUI app settings to iCloud (--force skips replace prompts)
```

> Re-export Raycast config periodically: Raycast → Export and overwrite `configs/raycast.rayconfig`.

---

## Where to Edit

| Want to... | Edit |
|------------|------|
| Add CLI tool | `modules/shared/packages.nix` |
| Add GUI app (cask) | `modules/darwin-system/homebrew.nix` → `homebrew.casks` |
| Add brew formula | `modules/darwin-system/homebrew.nix` → `homebrew.brews` |
| Add macOS system setting | `hosts/darwin/default.nix` → `system.defaults` |
| Add shell alias | `modules/shared/shell.nix` |
| Add macOS-only Home Manager config | `modules/darwin-home/default.nix` |
| Change git config | `modules/shared/git.nix` |
| Add npm global | `modules/shared/npm-global.nix` |

### Module Boundaries

Group by behavior and ownership boundary, not by app count. One-line installs
stay in package lists. If an app needs install entries plus config files,
activation hooks, launchd services, defaults writes, symlinks, or dependencies
across multiple places, create a focused module for that behavior.

Use `modules/shared/` for cross-platform Home Manager behavior,
`modules/darwin-home/` for macOS-only Home Manager behavior,
`modules/darwin-system/` for nix-darwin system behavior, and
`hosts/<hostname>/default.nix` for host-only differences.

## What's Managed Where

| Layer | Manages | Source of truth |
|-------|---------|-----------------|
| **nix-darwin** | macOS system settings | `hosts/darwin/default.nix` |
| **Homebrew module** | taps, brews, casks, MAS apps | `modules/darwin-system/homebrew.nix` |
| **home-manager** | CLI tools, shell, git, neovim, starship | `modules/shared/` + `modules/darwin-home/` |
| **Mackup → iCloud** | GUI app configs (Karabiner, Zed, VS Code, Warp…) | `~/Library/Mobile Documents/com~apple~CloudDocs/Mackup/` |
| **npm-global.nix** | npm global CLIs | `modules/shared/npm-global.nix` |
| **`configs/`** | Raycast export | manual import on new machine |
| **Manual** | SSH keys, credentials, Hermes plist, editable uv tools | — |

## Adding a Second Machine

1. Set hostname on new machine to match an existing config, **or** add a new entry to `flake.nix`:

```nix
darwinConfigurations."popemkt-mac2" = nix-darwin.lib.darwinSystem {
  system = "aarch64-darwin"; # x86_64-darwin for Intel
  specialArgs = { username = "popemkt"; hostname = "popemkt-mac2"; };
  modules = [
    ./hosts/darwin
    home-manager.darwinModules.home-manager
    (_: {
      users.users.popemkt.home = "/Users/popemkt";
      home-manager = {
        useGlobalPkgs = true;
        useUserPackages = true;
        backupFileExtension = "backup";
        extraSpecialArgs = { username = "popemkt"; hostname = "popemkt-mac2"; };
        users.popemkt = _: {
          home.stateVersion = "24.05";
          programs.home-manager.enable = true;
          imports = [ ./modules/shared ./modules/darwin-home ];
        };
      };
    })
  ];
};
```

2. `darwin-rebuild switch --flake ~/.dotfiles#popemkt-mac2`

Both configs start identical and diverge naturally over time via `if hostname ==` conditionals or separate host modules.

## Lint & Format

```bash
nixfmt **/*.nix
statix check .
deadnix --fail .
nix flake check --no-build
```

Pre-commit hook at `.githooks/pre-commit` runs all four on staged `.nix` files.
Activated via `git config core.hooksPath .githooks` (already set on this clone).

## Known Gaps

- npm globals not yet in `npm-global.nix`: `@tobilu/qmd`, `ccmanager`, `kanban`, `sudocode`, `yarn`
- editable/local uv tools not tracked: `browser-harness`, `cognee`, `mempalace`
- Hermes launchd plist — manual deploy
- `~/.local/bin` scripts (`hermes`, `iii`, `plannotator`) — depend on `/stuff` workspace
- `~/.gitconfig` has extra entries (nbstripout, agor safe.directory) not in `git.nix`
- Git nbstripout filter hardcodes `/Volumes/Data/...` — update after restore if needed
