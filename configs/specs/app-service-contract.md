# App Service Contract

Source of truth for the interface between app repositories, machine deployment,
and private Tailscale exposure.

Server applications developed locally should expose a small, predictable
runtime contract. The application repository owns how the app is built and
started. This dotfiles repository owns how a particular instance runs on this
machine and whether Tailscale exposes it.

## Required Runtime Hygiene

Every server app should:

- run as one foreground process
- accept its bind address and port through configuration
- default to a loopback bind address for local deployments
- write operational logs to stdout and stderr
- shut down cleanly on `SIGTERM`
- expose a lightweight health endpoint when it serves HTTP
- keep secrets out of source control and accept them by file or environment
- document mutable state, migrations, and backup requirements
- keep generated data outside the application source tree

Recommended conventional settings:

```text
HOST=127.0.0.1
PORT=3000
CONFIG_FILE=/path/to/config
SECRETS_FILE=/run/secrets/app
DATA_DIR=/path/to/persistent/state
```

Commit `.env.example` when environment variables form part of the interface.
Never commit `.env` or real credentials.

## Build Contract

An app does not need a Dockerfile merely because it opens a port.

Use a Dockerfile when the app is a deployable server, needs Linux-specific
dependencies, or should run identically in CI and production. Keep it
multi-stage, run as a non-root user, and do not bake configuration, secrets, or
mutable data into the image.

Use an app-local `flake.nix` or `devenv.nix` for reproducible developer tools
and commands. This machine repository must not become a hidden build dependency
of the app: the app repository should remain independently buildable and
testable.

## Deployment Ownership

Keep these concerns in the app repository:

- source code and dependency locks
- tests and build instructions
- Dockerfile when an OCI image is a deployment artifact
- configuration schema and safe defaults
- database migration commands

Keep these concerns in this repository:

- package or image version deployed on this machine
- launchd or container runtime configuration
- local bind address and port
- persistent state location and backup policy
- encrypted deployment secrets
- Tailscale Service exposure

## Tailscale Exposure

Declare an HTTP app listening locally on port 3000 like this:

```nix
my.stacks.vpn.services.my-api = {
  target = "http://127.0.0.1:3000";
  protocol = "https"; # This is the default.
  port = 443;
};
```

On a NixOS host, an app this repo runs natively is placed with `my.services`
instead, which generates both the systemd unit and the Service:

```nix
my.services.my-api = {
  owner = "popemkt";          # one of the host's my.people
  port = 3000;                # the app must listen on 127.0.0.1:3000
  package = pkgs.my-api;      # its main program, started with HOST and PORT set
  args = [ "serve" ];
};                            # exposed as svc:my-api-popemkt
```

Every app says what upgrades it, so that an upgrade restarts it, and the
module refuses an app that says neither:

- **`package`**: a Nix package. The unit runs its main program by store path,
  so a switch to a new version changes the unit and restarts the app.
- **`updatedBy`**: a tool a non-Nix installer owns, with `command` the shell
  command that runs it from the owner's PATH, e.g.
  `updatedBy.npmGlobal = "bb-app"`. After
  that installer upgrades the tool, it runs the one shared hook,
  `restart-apps-updated-by <installer> <tool>...`, which restarts the
  caller's apps that declared it (polkit lets each owner restart their own
  `app-*` units). `update-npm-globals` is the installer today. A new one adds
  its name to `updatedBy`'s tags and to the module's channel table, then
  calls the hook with what it changed; it never names an app.

An app made of several processes declares the others as `companions.<name>`
(a command, its own environment, and its own `idleCheck`), each its own unit
`app-<app>-<name>`, so each process restarts only for its own reasons; an
upgrade restarts all of them together, and an npm app's units run one pinned
copy of the package until then. An `idleCheck` on a unit defers its restarts
until the app reports idle (bb's host daemon, where agent threads run, while
bb's server restarts for its own changes at once).

An app that can listen on a Unix socket sets `socket = "/run/<dir>/<file>"`
instead of `port`. It gets no HOST or PORT; its arguments name the socket. The
unit creates `/run/<dir>` owned by the app's owner with mode 0700 and removes
it when the app stops. The Service then targets `unix:<socket>`. Use it when
the app treats every connection as its owner: any account on the host can
connect to a loopback port, but only the owner and root (tailscaled) can reach
that directory.

The attribute name becomes the Tailscale identity `svc:my-api`. Tailscale gives
it a separate TailVIP and MagicDNS name, so other services can also use port
443. Access is controlled by grants targeting `svc:my-api`.

Do not expose a service until it has authentication appropriate to its data and
the intended tailnet clients. Tailscale grants are the network boundary; app
authentication remains the application boundary.

After declaring a service, add its grant and its `autoApprovers.services`
entry for the host's tag to `configs/tailscale/policy.hujson` (the gate and CI
fail until both exist), and create its matching Service resource in the
Tailscale admin console. A rebuild then owns the host-side endpoint configuration.

## State And Secrets

Declarative configuration belongs in Nix. Mutable databases, uploaded files,
and generated application state belong in persistent storage with backups.

When encrypted repository secrets are introduced, use SOPS with age recipients.
Commit only ciphertext and public recipient keys. Decryption identities and
root credentials remain outside Git.
