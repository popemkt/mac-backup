# Troubleshooting

## Common Issues

### "error: attribute 'darwinConfigurations' missing"

**Cause:** No `darwinConfigurations.<hostname>` entry in `flake.nix` matches
your Mac's hostname (`hostname -s`).

**Fix:** Either pass the host explicitly
(`--flake ~/.dotfiles#<hostname>`), or add a host for this machine as described
in [README.md → Adding Another Machine](../README.md#adding-another-machine).
To rename an existing machine, see the rename note under Architecture in
[AGENTS.md](../AGENTS.md#architecture).

### "command not found: darwin-rebuild"

**Cause:** Shell hasn't picked up new PATH.

**Fix:** Restart your terminal, or:
```bash
source /etc/bashrc  # or restart terminal
```

### "error: collision between ..."

**Cause:** Two packages provide the same file.

**Fix:** Check the Home Manager package lists (usually under
`modules/common/home-manager/`). If intentional:
```nix
home.packages = [
  (pkgs.lib.lowPrio pkgs.somePackage)
];
```

### Existing dotfiles conflict

**Cause:** `~/.zshrc`, `~/.gitconfig` etc. already exist.

**Fix:**
```bash
mkdir ~/dotfiles-backup
mv ~/.zshrc ~/.gitconfig ~/.config/nvim ~/dotfiles-backup/
rebuild
```

### "error: attribute 'X' missing"

**Cause:** Package name is wrong.

**Fix:**
```bash
# Search for correct name
nix search nixpkgs yourpackage
```

### Slow first build

**Cause:** Downloading packages for the first time.

**Fix:** Just wait - subsequent builds are cached and fast.

### Homebrew casks not installing

**Cause:** Homebrew not in PATH during rebuild.

**Fix:**
```bash
# Make sure Homebrew is installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add to PATH for this session
eval "$(/opt/homebrew/bin/brew shellenv)"

# Rebuild
rebuild
```

### macOS settings not applying

**Cause:** Some settings need logout or restart.

**Fix:**
```bash
# Log out and back in
# or
killall Dock
killall Finder
killall SystemUIServer
```

### "error: flake 'path:...' does not provide attribute"

**Cause:** Flake structure issue.

**Fix:**
```bash
cd ~/.dotfiles
nix flake check  # Shows what's wrong
```

### Mackup restore fails

**Cause:** Not signed into cloud storage.

**Fix:**
1. Sign into iCloud/Dropbox/etc in System Settings
2. Check `.mackup.cfg` has correct storage engine
3. Run `mackup restore` again

### Git conflicts with home-manager

**Cause:** home-manager wants to manage `.gitconfig` but it exists.

**Fix:**
```bash
rm ~/.gitconfig
rebuild
```

## Rollback

### Rollback nix-darwin

```bash
# List generations
darwin-rebuild --list-generations

# Rollback to previous
darwin-rebuild --rollback

# Rollback to specific generation
darwin-rebuild --switch-generation 42 --flake ~/.dotfiles
```

### Rollback home-manager

```bash
# List generations
home-manager generations

# Rollback
/nix/var/nix/profiles/per-user/$USER/home-manager-XX-link/activate
```

## Full Reset

If everything is broken:

```bash
# 1. Uninstall Nix
/nix/nix-installer uninstall

# 2. Clean up
rm -rf ~/.config/home-manager
rm -rf ~/.local/state/nix
rm -rf ~/.local/state/home-manager

# 3. Remove generated dotfiles
rm ~/.zshrc ~/.gitconfig  # etc

# 4. Re-run bootstrap
~/.dotfiles/bootstrap.sh
```

## Debugging

### Check flake

```bash
cd ~/.dotfiles
nix flake check
nix flake show
```

### Verbose rebuild

```bash
darwin-rebuild switch --flake ~/.dotfiles --show-trace
```

### Check what changed

```bash
darwin-rebuild build --flake ~/.dotfiles
nix diff-closures /run/current-system ./result
```

### Outbound connections time out (NixOS hosts)

Every NixOS host runs `connectivity-probe`
(`modules/nixos/system/connectivity-probe.nix`): every 5 minutes it opens TCP
connections to fixed IPv4 and IPv6 endpoints and logs one line with the result,
ICMP reachability, the default route, Wi-Fi signal, conntrack and socket counts.

```bash
journalctl -u connectivity-probe              # every probe
journalctl -u connectivity-probe -p warning   # failed probes, with sockets by process
```

Read a failed line against the cause it points to:

- IPv4 TCP fails while ICMP and IPv6 work, with a low conntrack count and no
  Wi-Fi events: the router or ISP, not this host. Nothing in this repo fixes it.
- `syn-sent` or `established` far above normal, or one process dominating
  "sockets by process": a local process is fanning out connections.
- `wifi[...]` at a very low level, or `wpa_supplicant` beacon-loss events in
  `journalctl -u wpa_supplicant`: Wi-Fi.

A service that keeps failing and restarting can cause traffic by itself: a
start that downloads before it fails repeats the download on each restart. Check
`journalctl -u <unit> | grep -c 'Scheduled restart'` and the `incoming IP
traffic` figure on its `Consumed` lines. That is how the 2026-11-06 outage
investigation found `t3-code-popemkt` downloading a 117 MB release every 13
seconds since 2026-11-04, because `tar` was missing from its `PATH`.

## Getting Help

1. [nix-darwin manual](https://daiderd.com/nix-darwin/manual/)
2. [Home Manager manual](https://nix-community.github.io/home-manager/)
3. [NixOS Discourse](https://discourse.nixos.org/)
4. Ask Claude to debug error messages
