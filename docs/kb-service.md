# kb service

The `kb` stack owns the packaged CLI and the optional supervised browser UI.
Both hosts enable the stack; only `popemkt-personal` enables `server.enable`.

## Personal instance

`hosts/popemkt-personal/default.nix` selects `/Volumes/Data/workspace/repos/_brain`
as the graph checkout. The server listens on loopback port 9000. Its
`listenOrigin` supplies the target for `vpn.services.kb`; that service's
computed `publicOrigin` supplies the UI's `--public-origin` argument. The
route, request guard, and health check therefore derive their addresses from
the same declarations. The guard's contract is in
[tools/kb/DESIGN.md](../tools/kb/DESIGN.md).

The `org.nixos.kb-ui` user launchd agent executes the Nix-packaged binary with
an explicit `--root`, `--port`, `--no-open`, and, when configured,
`--public-origin`. It starts when the user logs in, restarts if the process
exits, and stops when the user logs out. Its runtime paths are supplied
explicitly; it does not depend on an interactive shell or a source checkout's
`node_modules`. Logs go to `~/Library/Logs/kb-ui.log`.

Apply the declaration with `rtk rebuild`. Stop a manually started kb process
on the same port before applying, so the supervised instance can bind.

## Readiness

`system-setup status` first checks that the declared launchd job is running,
has the evaluated command arguments, and owns the configured listening port.
A manual server cannot satisfy that check. It then checks the declared browser origin's `/api/identity`
with that same `Origin` header, then verifies that the returned `root` is the
configured graph checkout. A process serving only HTML, a request-guard
rejection, or the wrong graph cannot pass. On personal, the check depends on
the existing `tailscale-service-kb` routing and approval check. `rebuild`
already runs this readiness check alongside the system drift audit.

## Other deployments

Use the canonical graph path (resolve symlinks) so it matches kb API identity.

Set `my.stacks.kb.enable`, `server.enable`, and `server.root` on the intended
host. Set `server.port` when changing the loopback listener. For a reverse
proxy, set `server.publicOrigin` to the browser origin; for a Tailscale
service, derive it from that service's `publicOrigin` and derive the target
from `server.listenOrigin`, as personal does. Link any routing prerequisite
through the instance's system-setup `dependsOn` declaration.

macOS privacy approvals are external state. A launchd process can be blocked
from reading an external volume even when the same command works in a terminal.
The supervised-listener check exposes this failure and its enrollment action
opens Full Disk Access settings. Authorize the evaluated kb executable there
when required, then restart the job. A new Nix package path may need approval
again. The process uses the user's home as its working directory; the graph
path belongs solely to `--root`.

The graph checkout and its `.kb` content remain user data. The service never
initializes a replacement graph; restore the existing checkout before starting
it. Backup ownership follows [backup-strategy.md](backup-strategy.md).
