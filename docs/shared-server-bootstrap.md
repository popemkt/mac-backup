# shared-server bootstrap

Instructions for the agent running on the NixOS machine itself. They take the
machine from the installer's `/etc/nixos/configuration.nix` to a host that this
repository owns. Why the host has this shape is stated once, in the
[plan's Decision section](shared-nixos-server-plan.md#decision); this file is
only the procedure.

Everything needed is on `main`; start from an up-to-date checkout of it
(`git pull`). Commit the restructure and the additions separately, as
[AGENTS.md](../AGENTS.md) requires, and push to `main` once the host has
switched successfully.

## Where the repository lives

At `~/.dotfiles` in the account of whoever edits it: `/home/popemkt/.dotfiles`
now, and `/home/bytetum/.dotfiles` if bytetum edits the configuration later.
`~/.dotfiles` is a repo invariant on every host (backups, the `rebuild`
command and the drift audit assume it), so do not move it to a shared path
such as `/srv`. One configuration still manages the whole machine, both users
included; the clone is only where it is edited. GitHub `main` is the source of
truth: `git pull` before every rebuild, because the last rebuild decides what
is live.

Clone it with `gh repo clone popemkt/mac-backup ~/.dotfiles` and run
`git config core.hooksPath .githooks` so commits pass the repo's gate.

## Where things stand

Done on the Mac, already on `main`:

- `modules/stacks/default.nix` is the platform-neutral stack index (the vpn
  schema and the `extra.*` fold). `modules/stacks/darwin.nix` adds the
  macOS-only stacks.
- `modules/stacks/vpn/services-reconcile.nix` is the Tailscale Services
  reconcile script, platform-neutral. `vpn/darwin.nix` runs it under launchd.
- `modules/stacks/t3-code/` is its own stack. `darwin.nix` installs the
  desktop app; the NixOS side does not exist yet.

Done on the machine by hand, outside the repo: a NixOS 26.05 install and
`programs.nix-ld.enable = true`. Flakes and the other preflight steps are in
[Fresh machine: manual steps](#fresh-machine-manual-steps).

## Fresh machine: manual steps

Everything here happens before the repo is involved, and most of it needs root
or a password. The agent cannot do these, so do them in order on a new machine.

1. **Install NixOS 26.05** with the installer. Keep the generated
   `/etc/nixos/configuration.nix` for now; the repo replaces it in
   [Take over the machine](#take-over-the-machine).
2. **Enable flakes.** `/etc/nixos/configuration.nix` is root-owned, so edit it
   with sudo:

   ```bash
   sudo vim /etc/nixos/configuration.nix
   ```

   Inside the top-level `{ ... }` block, next to `programs.nix-ld.enable = true;`, add:

   ```nix
   nix.settings.experimental-features = [ "nix-command" "flakes" ];
   ```

   Then rebuild from the installer config, and check that both features are on:

   ```bash
   sudo nixos-rebuild switch
   nix config show experimental-features   # must list nix-command and flakes
   ```

   If `nix config show` says `nix-command` is disabled, the rebuild did not take
   effect; do not continue until it does.
3. **Confirm `programs.nix-ld.enable = true;`** is in the installer config, as
   step 2 above puts it next to the flakes line.
4. **Clone the repo and enable the commit gate:**

   ```bash
   gh repo clone popemkt/mac-backup ~/.dotfiles
   cd ~/.dotfiles && git config core.hooksPath .githooks
   ```

5. **Tailscale console (needs an admin account):**
   - Create the services `t3-popemkt` and `t3-bytetum`. Enter the names
     without the `svc:` prefix; the console rejects it. The policy file refers
     to them as `svc:t3-popemkt` and `svc:t3-bytetum`.
   - Create an auth key with `tag:shared-server` selected, and note its expiry.
     The key is used later by `scripts/shared-server-secrets apply`.
   - The policy rerun (see [Secrets and manual steps after the switch](#secrets-and-manual-steps-after-the-switch))
     only works after the service auto-approvers are on `main`.
6. **Pick the T3 Code ports.** The defaults are `3773` (popemkt) and `3774`
   (bytetum). Avoid `6768`, which Orca uses on the Macs.
7. **Fill the secrets file** only after the switch, through
   [Secrets and manual steps after the switch](#secrets-and-manual-steps-after-the-switch).
   Do not run `apply` before the switch: the bytetum user does not exist yet.

## Target state

| Area | What the host has |
|---|---|
| Identity | Host name `shared-server`, `x86_64-linux`, `system.stateVersion` copied from the installer config and never changed |
| Accounts | `popemkt` and `bytetum`, both `isNormalUser` and in `wheel`, `linger = true` so their services run without a login. No passwords in the repo |
| Access | No `services.openssh`. The local console is the recovery path |
| Laptop as server | `services.logind.lidSwitch = "ignore"` (and the external-power and docked variants), so closing the lid never suspends |
| Binaries | `programs.nix-ld.enable = true`, plus `nix-ld.libraries` if a binary reports a missing library |
| Agents | Per user, from npm into `~/.local`: `t3`, `@anthropic-ai/claude-code`, `@openai/codex` |
| T3 Code | One `t3 serve` per user as a systemd user service, bound to `127.0.0.1` on its own port |
| Tailscale | `services.tailscale.enable`. The host advertises `svc:t3-popemkt` and `svc:t3-bytetum`; both people may reach both |
| Tooling | Flakes, `git`, `gh`, vim as default editor |

## Build it in the repo

1. **Capture the machine.** Copy `/etc/nixos/hardware-configuration.nix` to
   `hosts/shared-server/hardware-configuration.nix`. Read
   `/etc/nixos/configuration.nix` and carry over everything the installer set
   that the host still needs: the boot loader (without it the machine will not
   boot), networking (NetworkManager, so the saved Wi-Fi keeps working),
   time zone, locale, keyboard, and `system.stateVersion`.
   If a `hosts/shared-server/hoang/` folder shows up, it is of unknown origin;
   ask before using or deleting it. It did not exist on 2026-10-16.

2. **Restructure first, as its own commit.** These are behavior-preserving
   for both Macs; prove it by evaluating both `darwinConfigurations` before
   and after.
   - `modules/common/home-manager/` mixes portable and Mac-only settings
     (`git.nix` uses the macOS keychain; `packages.nix` lists desktop
     software). Split it so a Linux user can import a portable base without
     the Mac parts. `npm-global.nix` is already portable and is the npm
     executor the server reuses.
   - `my.role` (`work`/`personal`) is required by Mac modules only. Do not
     give the server a role; scope the option so a NixOS host evaluates
     without one.
   - In `flake.nix`, factor what `mkDarwin` shares (the `my.*` values, the
     overlay, Home Manager defaults) so a `mkNixos` can reuse it rather than
     copy it.

3. **Add the NixOS side, as a second commit.**
   - `flake.nix`: `nixosConfigurations.shared-server` from `mkNixos`, with
     `home-manager.nixosModules.home-manager` and both users. Keep
     `pkgs/` packages that only build on macOS out of the Linux evaluation.
   - `modules/stacks/nixos.nix`: imports `./default.nix`,
     `./t3-code/nixos.nix`, `./vpn/nixos.nix`.
   - `modules/stacks/vpn/nixos.nix`: `services.tailscale.enable`, and a
     systemd service running `services-reconcile.nix` with
     `${pkgs.tailscale}/bin/tailscale` and a state directory under
     `/var/lib`.
   - `modules/stacks/t3-code/nixos.nix`: the T3 Code server instances. Model
     an instance once (user, port, data directory) and derive each user's
     systemd user service and its `vpn.services` entry from it; do not write
     the service twice. It contributes `t3`, `@anthropic-ai/claude-code` and
     `@openai/codex` to `my.pkgs.npmGlobals` and depends on `nix-ld`. The
     service runs `t3 serve --host 127.0.0.1 --port <port> --no-browser`
     with Node on its `PATH` (see "Writing an executor" in AGENTS.md).
   - `modules/nixos/home-manager/default.nix`: its `rebuild` alias uses
     plain `sudo nixos-rebuild`; change it to the `--sudo` form described
     under "Take over the machine".
   - `modules/nixos/system/`: the host base (nix settings, nix-ld, lid
     handling, editor, git and gh).
   - `hosts/shared-server/default.nix`: imports the base and the hardware
     file, declares both users, enables the `t3-code` and `vpn` stacks.
     Ports are a host choice; for example 3773 for popemkt and 3774 for
     bytetum.
   - `configs/tailscale/policy.hujson`: `tag:shared-server` is already in
     `tagOwners` and applied. Add auto-approval of `svc:t3-popemkt` and `svc:t3-bytetum` for that tag, and
     a grant from `autogroup:member` to both services on `tcp:443`.
   - `docs/tailscale.md`: add the two services to its Services table.
   - Validate CI's Linux gap: `.github/workflows/validate.yml` runs on macOS
     only. Record a `#gap` in kb if the NixOS host stays unchecked by CI.

4. **Check before switching.**

   ```bash
   nix flake check --no-build
   nixos-rebuild build --flake .#shared-server
   ```

## Take over the machine

```bash
nixos-rebuild test --flake ~/.dotfiles#shared-server --sudo    # activate, no boot entry
nixos-rebuild switch --flake ~/.dotfiles#shared-server --sudo  # make it the boot default
```

`--sudo` builds as the repository's owner and only activates as root. Plain
`sudo nixos-rebuild` makes root read a repository it does not own, which
recent Nix refuses with "repository path is not owned by current user". On a
NixOS older than nixos-rebuild-ng the flag is `--use-remote-sudo`.

`test` first: if networking or the console breaks, a reboot returns to the
installer configuration. After `switch`, the previous generation stays in the
boot menu, and `sudo nixos-rebuild switch --rollback` undoes it. From then on
the repository owns the system and `/etc/nixos/configuration.nix` is no longer
read. Move it aside so a plain `nixos-rebuild switch` fails loudly instead of
quietly rebuilding the installer configuration, and rebuild with the `rebuild`
alias (`nixos-rebuild switch --flake ~/.dotfiles --sudo`) from then on:

```bash
sudo mv /etc/nixos /etc/nixos.installer
```

## Secrets and manual steps after the switch

These are control-plane or secret state and never belong in the repo.

1. **Secrets go through a file the agent never reads.** Run
   `scripts/shared-server-secrets init`, then ask the person to fill in
   `~/shared-server-secrets.env` themselves. Do not open, print, or grep that
   file: anything an agent reads enters its transcript. When they say it is
   filled, run `scripts/shared-server-secrets apply`, which sets the
   passwords, joins the tailnet with the auth key, and deletes the file. If
   it fails, report the error and leave the file for the person to fix.
2. `tag:shared-server` is already in the applied policy, so a tagged auth key
   can be generated at any time. In the Tailscale console create `t3-popemkt` and
   `t3-bytetum` (no `svc:` prefix; policy uses the prefixed form), then rerun the policy workflow so its auto-approver sees
   them. The full sequence is
   [First Tailnet Or Replacement Host](tailscale.md#first-tailnet-or-replacement-host).
3. Each person, in their own account: sign in to Claude Code (`claude`) and
   Codex (`codex`), then pair their devices with their T3 Code server
   (`t3 pair`). bytetum changes the temporary password with `passwd`.

## Done when

- Both Mac configurations still evaluate, and `shared-server` builds.
- After a reboot, both T3 Code servers run without anyone logged in.
- From another tailnet device, both people can open both T3 Code services
  over HTTPS, and nothing is reachable on the LAN or the public interface.
- `claude --version` and `codex --version` work in both accounts.
- Closing the lid does not suspend the machine.
