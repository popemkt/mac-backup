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

The host's configuration is written and on `main`. It evaluates on the Mac;
it has not been built, because the Mac cannot build x86_64-linux. The first
real build happens on this machine, in [Check before switching](#check-before-switching).

| Piece | Where |
|---|---|
| The host | `hosts/shared-server/` (installer settings, people, ports, stacks) and `nixosConfigurations.shared-server` from `mkNixos` in `flake.nix` |
| NixOS base | `modules/nixos/system/` (accounts and Home Manager for each of `my.people`, flakes, nix-ld, zsh, vim, git, gh) |
| T3 Code servers | `modules/stacks/t3-code/` (`instances` schema, NixOS systemd services, npm agents) |
| Tailscale | `modules/stacks/vpn/nixos.nix` (tailscaled, Services reconcile under systemd) and `configs/tailscale/policy.hujson` |
| Each person | `users/popemkt/`, `users/bytetum/` |

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
| Identity | Host name `shared-server`, `x86_64-linux`, `system.stateVersion = "26.05"` from the installer, never changed |
| Accounts | `popemkt` and `bytetum` (`my.people`), both in `wheel` and `networkmanager`, zsh. No passwords in the repo |
| Access | No `services.openssh`. The local console is the recovery path |
| Laptop as server | `services.logind.settings.Login.HandleLidSwitch*` = `ignore`, so closing the lid never suspends |
| Binaries | `programs.nix-ld.enable = true`, plus `programs.nix-ld.libraries` if a binary reports a missing library |
| Agents | Per user, from npm into `~/.local`: `t3`, `@anthropic-ai/claude-code`, `@openai/codex` |
| T3 Code | One `t3 serve` per person, a system service (`t3-code-popemkt`, `t3-code-bytetum`) running as that user, bound to `127.0.0.1:3773` and `:3774` |
| Tailscale | `services.tailscale.enable`. The host advertises `svc:t3-popemkt` and `svc:t3-bytetum`; both people may reach both |
| Tooling | Flakes, `git`, `gh`, vim as root's editor, Neovim for users |

## Check before switching

From `~/.dotfiles` on this machine, after `git pull`:

```bash
nix flake check --no-build
nixos-rebuild build --flake .#shared-server
```

A build failure here is a real defect in the configuration: fix it in the
repo, commit and push, rather than patching `/etc/nixos`. The NixOS
configuration was written without a Linux machine to build on, so expect to
find something. Option names to suspect first: `services.logind.settings`
and the `--sudo` flag of `nixos-rebuild`.

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
