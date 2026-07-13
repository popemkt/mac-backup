# Dotfiles Functional Spec

## Purpose

A declarative macOS developer environment that can be fully restored on any
Apple Silicon Mac from a single git clone. The system maximises what is tracked
in version control and minimises what must be done manually.

---

## Environment Bootstrap

- A new machine can reach a working developer environment by running a small
  sequence of commands (CLT, Nix, Homebrew, clone, rebuild).
- After the first rebuild, the terminal has all CLI tools, shell config, git
  config, starship prompt, neovim, and npm/uv globals in place.
- No subsequent manual installs are needed for CLI tooling.
- GUI application configs are restored by a single `mackup restore` after iCloud
  syncs.
- The bootstrap sequence is documented in README.md and is the executable
  definition of a complete restore.

## Daily Config Changes

- Adding a CLI tool, shell alias, git setting, or GUI app requires editing one
  file and running `rebuild`.
- The change is immediately reproducible on any machine that pulls and rebuilds.
- Pre-commit hooks validate nix syntax, format, and dead bindings before every
  commit.
- Direct GitHub release packages have reusable check/update commands; online
  pre-commit checks are best-effort and offline checks do not block commits.
- `rebuild` reports available direct-release updates but never applies them;
  updating versions and hashes remains an explicit operator action.

## GUI App Settings Sync

- App settings for Karabiner, Zed, VS Code, Warp, AltTab, Telegram, Claude
  Code, and macOS keyboard shortcuts are synced to iCloud via Mackup.
- A `mackup backup --force` on the source machine pushes current state.
- A `mackup restore` on a new machine pulls and links that state.
- Only explicitly allowlisted apps are synced. Apps that store credentials or
  tokens are never added to the allowlist.

## Multi-Machine Support

- A second machine can use the same config by setting its hostname to match the
  existing flake entry.
- A second machine can get an independent config by adding a new
  `darwinConfigurations` entry to `flake.nix` with a different hostname.
- Both machines share all common modules; divergence happens through per-host
  conditionals or separate host modules.

## Always-On Services

- The headroom context-compression proxy runs as a launchd user daemon on every
  machine after rebuild.
- CLIProxyAPI runs as a loopback-only launchd user daemon on every machine after
  rebuild; provider OAuth remains a manual credential step, and its no-key
  listener explicitly trusts processes that can reach the local loopback port.
- The proxy starts automatically on login, restarts on failure, and logs to
  `~/Library/Logs/headroom-proxy.{out,err}.log`.
- `HEADROOM_PROXY` and `HEADROOM_PORT` are available to all apps and shells via
  launchd environment variables.

## Config Auditing

- Running `sysaudit` reports drift between declared nix config and what is
  actually installed (Homebrew casks/brews, npm globals, uv tools).
- Login items are captured to `configs/login-items.txt` via `dump-login-items`.

## Spec and Workflow Reuse

- The `configs/specs/` directory holds engineering specs (cohesion, dotfiles
  system, this file) that can be loaded by Archon workflows.
- The `configs/archon/` directory holds reusable advisory workflow harnesses
  for cohesion review and change-check validation.

---

## Non-Goals

- Windows or Linux support. The system is macOS aarch64-only; NixOS modules are
  kept in-tree for potential future use but are not built or maintained.
- Hermetic Python environments. `uv tool install` is imperative; Nix provides
  the declaration of intent, not a locked derivation.
- Automatic credential rotation or secret management. Credentials are never
  tracked and must be set up manually on each machine.
- Automatic login item restore. macOS 13+ has no public API for programmatic
  login item creation.
- Managing apps available only from the Mac App Store without `mas` configured.

---

## Acceptance Criteria

### New machine restore

- After running the bootstrap sequence (README §1-9), a new terminal session
  has: `rebuild`, `git`, `gh`, `nvim`, `node`, `uv`, `mackup`, starship prompt,
  zsh aliases, and all declared npm globals in PATH.
- `headroom` is installed and the `headroom-proxy` launchd agent is loaded.
- `cli-proxy-api` is installed and its launchd agent is loaded on port 8317.
- After `mackup restore`, Karabiner rules, Zed settings, VS Code settings,
  Warp config, and AltTab layout match the source machine.

### Daily change

- Editing a nix file and running `rebuild` applies the change without manual
  follow-up.
- `git commit` on a staged `.nix` file runs nixfmt, statix, deadnix, and
  `nix flake check --no-build`; a failing check blocks the commit.

### Drift detection

- `sysaudit` outputs no unmanaged Homebrew casks/brews, npm globals, or uv
  tools beyond those explicitly excluded as editable/local installs.

### GUI config sync

- `mackup backup --force` on the source machine does not sync any file outside
  the explicit `[applications_to_sync]` allowlist.
- No credential files appear under `~/Library/Mobile Documents/com~apple~CloudDocs/Mackup/`.
