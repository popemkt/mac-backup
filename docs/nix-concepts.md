# Nix Concepts

Understanding how this dotfiles setup works.

## Flakes vs Channels

### Channels (Traditional Nix)

```bash
# Add a channel - follows "latest"
nix-channel --add https://nixos.org/channels/nixpkgs-unstable nixpkgs
nix-channel --update

# Install from channel
nix-env -iA nixpkgs.ripgrep
```

**Pinning with channels (manual):**
```bash
# Pin to specific commit (ugly, manual)
nix-channel --add https://github.com/NixOS/nixpkgs/archive/abc123def.tar.gz nixpkgs
```

### Flakes (What We Use)

```nix
# flake.nix - declare dependencies
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };
}
```

```json
// flake.lock - auto-generated, pins exact commits
{
  "nodes": {
    "nixpkgs": {
      "locked": {
        "rev": "abc123...",
        "lastModified": 1706745600
      }
    }
  }
}
```

### Comparison

| Feature | Channels | Flakes |
|---------|----------|--------|
| Pinning | Manual (re-add with commit URL) | Automatic (`flake.lock`) |
| Lock file | None | `flake.lock` |
| Reproducibility | Requires manual discipline | Built-in |
| Update | `nix-channel --update` | `nix flake update` |
| Rollback | Hope you remember the commit | `git checkout flake.lock` |

**Why flakes?** The lock file is version-controlled. Clone repo → same versions everywhere.

---

## Nix Store

All packages live in `/nix/store/`:

```
/nix/store/
├── abc123-ripgrep-14.1.0/
│   └── bin/ripgrep
├── def456-nodejs-22.0.0/
│   └── bin/node
└── xyz789-zsh-config/
    └── .zshrc
```

- Packages are **immutable** (never modified after build)
- Multiple versions can coexist
- Unused packages cleaned with `nix-collect-garbage`

---

## Generations

Each `rebuild` creates a generation (system snapshot):

```bash
# List generations
darwin-rebuild --list-generations

# Output:
# 1   2024-01-31 10:00 - initial setup
# 2   2024-01-31 11:00 - added ripgrep
# 3   2024-01-31 12:00 - updated node  ← current
```

**Rollback:**
```bash
darwin-rebuild --rollback           # Go to previous
darwin-rebuild --switch-generation 1  # Go to specific
```

---

## Derivations

A derivation = build recipe. When you write:

```nix
home.packages = [ pkgs.ripgrep ];
```

Nix:
1. Finds the derivation for ripgrep
2. Checks if `/nix/store/abc123-ripgrep-14.1.0/` exists
3. If not, builds/downloads it
4. Adds it to your environment

---

## nix shell vs nix develop vs rebuild

| Command | Scope | Duration | Use Case |
|---------|-------|----------|----------|
| `rebuild` | System | Permanent | Daily tools |
| `nix shell nixpkgs#pkg` | Current shell | Until exit | Quick one-off |
| `nix develop` | Project | While in project | Per-project deps |

### Examples

```bash
# Permanent: part of your system
rebuild  # Installs what's in home.nix

# Temporary: need ffmpeg for 5 minutes
nix shell nixpkgs#ffmpeg
ffmpeg -version
exit  # Gone

# Per-project: this repo needs Node 18
cd ~/old-project
nix develop  # Uses project's flake.nix
node --version  # 18.x
cd ~
node --version  # Back to system version (22.x)
```

---

## Common Commands

```bash
# Update all inputs to latest
nix flake update

# Update specific input
nix flake lock --update-input nixpkgs

# Show flake structure
nix flake show

# Check flake for errors
nix flake check

# Search packages
nix search nixpkgs ripgrep

# Run package without installing
nix run nixpkgs#cowsay -- "Hello"

# Garbage collect old generations
nix-collect-garbage -d

# See what would be built
nix build --dry-run
```

---

## Reference Configurations

### [dustinlyons/nixos-config](https://github.com/dustinlyons/nixos-config)

A comprehensive cross-platform (NixOS + macOS) starter template.

**Structure:**
```
nixos-config/
├── apps/          # Bootstrap and build commands
├── hosts/         # Host-specific configs (per-machine)
├── modules/       # Platform-specific (darwin/nixos) + shared
├── overlays/      # Package patches/overrides
└── templates/     # Starter variants
```

**Notable features:**
- Cross-platform: same config for Linux and macOS
- Secrets management via `agenix` (encrypted SSH keys, API tokens)
- CI auto-updates weekly
- Video tutorials for beginners

**Comparison to our setup:**

| Aspect | Our Setup | dustinlyons |
|--------|-----------|-------------|
| Platforms | macOS only | macOS + NixOS |
| Structure | Simple (`modules/`) | More dirs (`hosts/`, `apps/`, `overlays/`) |
| Secrets | None (use Mackup) | agenix (encrypted in repo) |
| Complexity | Beginner-friendly | More comprehensive |
| GUI apps | Homebrew | Homebrew (mac) / native (linux) |

**When to consider their approach:**
- You use both Linux and macOS
- You want secrets (API keys, SSH keys) in your repo (encrypted)
- You have multiple machines with different configs

**Our approach is simpler if:**
- macOS only
- Single machine (or identical setup across machines)
- GUI app configs via Mackup is fine

Both are valid - ours prioritizes simplicity, theirs prioritizes cross-platform power.

---

## Useful Resources

### Learning
- [Nix Pills](https://nixos.org/guides/nix-pills/) - Deep dive tutorial
- [nix.dev](https://nix.dev/) - Official learning resource
- [NixOS Wiki](https://nixos.wiki/) - Community wiki
- [Zero to Nix](https://zero-to-nix.com/) - Modern beginner guide

### Reference Docs
- [Home Manager Options](https://nix-community.github.io/home-manager/options.xhtml)
- [nix-darwin Options](https://daiderd.com/nix-darwin/manual/)
- [Nixpkgs Search](https://search.nixos.org/packages)

### Example Configs
- [dustinlyons/nixos-config](https://github.com/dustinlyons/nixos-config) - Cross-platform starter
- [Misterio77/nix-starter-configs](https://github.com/Misterio77/nix-starter-configs) - Minimal templates
- [ryan4yin/nix-darwin-kickstarter](https://github.com/ryan4yin/nix-darwin-kickstarter) - macOS focused
