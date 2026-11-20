# Container apps on NixOS

Use [the app service contract](../configs/specs/app-service-contract.md) to
choose placement. Declare the owner, socket or loopback port, and `image` in
`my.services`. The same systemd unit and optional Tailscale Service handle both
native and container apps. Use the app's own format for files under
`container.files`. These mounts and the portable copies are readable
configuration, so keep credentials in protected runtime state.

The unit uses rootless Podman so the container's root maps to the app owner.
The owner's user manager stays running after logout to provide Podman's
runtime directory. The unit loads the digest-pinned archive from the Nix store,
so boot needs no registry access. Use `journalctl -u app-<entry>` for logs and
the app's health endpoint to check readiness.

A port application listens inside the container on `container.port`, which
defaults to the declared host port. Podman publishes it on `127.0.0.1`.
A socket application writes into the unit's private socket directory and has
its container network disabled by default. Both can use
`svc:<app>-<owner>` for tailnet HTTPS. See [Tailscale](tailscale.md) for Service
registration and policy.

The build checks image-declared `VOLUME` paths before it produces the unit
or the portable bundle. A volume needs an explicit persistent mount at that
exact path (`container.dataPath`). Podman uses the explicit mounts and ignores
image volume defaults. Images with several declared persistent volumes need a
placement mechanism that can map each one before they can run here.

## Move to Docker Compose

1. Copy `/etc/app-containers/<entry>/` with symlinks dereferenced to a writable
   directory on the destination. It contains `compose.yaml` and the app's files.
2. Stop writes at the source and restore a consistent copy of
   [the data directory](backup-strategy.md#nixos-container-state) to `./data`
   beside the Compose file. Give the destination container user access.
3. For a socket app, create `./run` with mode 0700 for the runtime user and
   point the destination proxy at the socket it will contain. For a port app,
   point the proxy at the published loopback port.
4. Run `docker compose up -d` from the bundle. Configure the destination
   proxy/TLS and keep the app's public URL consistent with its config.

The Compose file points to the same registry digest. The destination runtime
pulls that digest unless it already has it.

## Verification

Run the Linux VM check with KVM available:

~~~bash
scripts/dev nix build -L .#checks.x86_64-linux.app-containers
~~~
