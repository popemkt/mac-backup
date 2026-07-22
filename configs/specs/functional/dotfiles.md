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
  config, starship prompt, neovim, and npm/Bun/uv globals in place.
- No subsequent manual installs are needed for CLI tooling.
- GUI application configs are restored by a single `mackup restore` after iCloud
  syncs.
- The bootstrap sequence is documented in README.md and is the executable
  definition of a complete restore.
- External OAuth, device, key, and control-plane requirements are declared per
  host and exposed through one `system-setup` status/enrollment workflow.

## Daily Config Changes

- Adding a CLI tool, shell alias, git setting, or GUI app requires editing one
  file and running `rebuild`.
- The change is immediately reproducible on any machine that pulls and rebuilds.
- Pre-commit hooks validate nix syntax, format, and dead bindings before every
  commit.
- Direct release packages have reusable check/update commands; online
  pre-commit checks are best-effort and offline checks do not block commits.
- `rebuild` reports available direct-release updates but never applies them;
  updating versions and hashes remains an explicit operator action.
- `rebuild` reports external setup readiness without initiating enrollment or
  failing merely because an operator action remains.
- `rebuild` upgrades Homebrew packages and every declared npm/Bun global to
  its latest registry release; transient upgrades preserve the installed
  version rather than blocking activation.

## GUI App Settings Sync

- App settings for Karabiner, Zed, VS Code, Warp, AltTab, Telegram, Claude
  Code, Snapzy, and macOS keyboard shortcuts are synced to iCloud via Mackup.
- Raycast remains a deliberate export/import workflow through
  `configs/raycast.rayconfig`; its live plist and encrypted databases mix
  portable preferences with device, permission, account, and runtime state.
- A `mackup backup --force` on the source machine pushes current state.
- A `mackup restore` on a new machine pulls and links that state.
- Only explicitly allowlisted apps are synced. Apps that store credentials or
  tokens are never added to the allowlist.

## Multi-Machine Support

- Each machine has a `hosts/<hostname>/default.nix` module and a matching
  `darwinConfigurations` entry composed through the shared `mkDarwin` helper.
- Machines share common modules; roles and host-only differences live in their
  host modules.
- The configured macOS hostname matches the selected flake attribute.

## Always-On Services

- The headroom context-compression proxy runs as a launchd user daemon on every
  machine after rebuild, and RTK is installed for token-optimized shell output.
- CLIProxyAPI runs as a loopback-only launchd user daemon on every machine after
  rebuild; provider OAuth remains a manual credential step, and its no-key
  listener explicitly trusts processes that can reach the local loopback port.
- The `claudex` shell function runs Claude Code against GPT-5.6 Sol through the
  existing CLIProxyAPI listener without changing normal `claude` sessions.
- The personal host can expose explicitly declared loopback apps as independent
  Tailscale Services. Undeclared apps remain private to the host.
- The personal host is the only Cognee data and processing node. Authorized
  remote Macs use a loopback-only MCP bridge and the same authenticated
  Tailscale HTTPS origin instead of creating local knowledge stores.
- Authenticated Cognee UI and API uploads work through its temporary-file
  loader while arbitrary HTTP URL ingestion remains disabled.
- Remote Cognee credentials are unique per machine, remain mutable state, and
  are never committed. The work host uses a separate account when work data
  requires an authorization boundary.
- The proxy starts automatically on login, restarts on failure, and logs to
  `~/Library/Logs/headroom-proxy.{out,err}.log`.
- `HEADROOM_PROXY` and `HEADROOM_PORT` are available to all apps and shells via
  launchd environment variables.

## Config Auditing

- Running `sysaudit` reports drift between declared nix config and what is
  actually installed (Homebrew casks/brews, npm globals, Bun globals, uv tools).
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
- Hermetic packaging of third-party Python services installed through uv.
  Repo-owned automation such as `system-setup` is locked by uv and built
  hermetically with `uv2nix`; mutable Cognee and Headroom environments retain
  their service-specific activation model.
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
  zsh aliases, and all declared npm/Bun globals in PATH.
- `headroom` and `rtk` are installed, and the `headroom-proxy` launchd agent is
  loaded.
- `cli-proxy-api` is installed and its launchd agent is loaded on port 8317.
- Cursor CLI is installed as both `agent` and `cursor-agent`; authentication is
  a manual `agent login` step.
- `system-setup status --json` provides a machine-readable per-host inventory,
  and `system-setup verify` fails until every required integration is ready.
- On `popemkt-work`, `cognee-client-enroll` provisions the per-machine key and
  `cognee-client-status` verifies the central API and local MCP bridge.
- After `mackup restore`, Karabiner rules, Zed settings, VS Code settings,
  Warp config, AltTab layout, and Snapzy preferences match the source machine.

### Daily change

- Editing a nix file and running `rebuild` applies the change without manual
  follow-up.
- `git commit` on a staged `.nix` file runs nixfmt, statix, deadnix, and
  `nix flake check --no-build`; a failing check blocks the commit.

### Drift detection

- `sysaudit` outputs no unmanaged Homebrew casks/brews, npm/Bun globals, or uv
  tools beyond those explicitly excluded as editable/local installs.

### GUI config sync

- `mackup backup --force` on the source machine does not sync any file outside
  the explicit `[applications_to_sync]` allowlist.
- No credential files appear under `~/Library/Mobile Documents/com~apple~CloudDocs/Mackup/`.
