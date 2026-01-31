# Troubleshooting

## Common Issues

### "error: attribute 'darwinConfigurations' missing"

**Cause:** Hostname in `flake.nix` doesn't match your Mac's hostname.

**Fix:**
```bash
# Find your hostname
hostname -s

# Edit flake.nix and update:
hostname = "your-actual-hostname";
```

### "command not found: darwin-rebuild"

**Cause:** Shell hasn't picked up new PATH.

**Fix:** Restart your terminal, or:
```bash
source /etc/bashrc  # or restart terminal
```

### "error: collision between ..."

**Cause:** Two packages provide the same file.

**Fix:** Check for duplicates in `home.nix`. If intentional:
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
darwin-rebuild switch --flake ~/.dotfiles --switch-generation 42
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

## Getting Help

1. [nix-darwin manual](https://daiderd.com/nix-darwin/manual/)
2. [Home Manager manual](https://nix-community.github.io/home-manager/)
3. [NixOS Discourse](https://discourse.nixos.org/)
4. Ask Claude to debug error messages
