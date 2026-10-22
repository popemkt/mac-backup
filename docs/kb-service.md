# kb service

The `kb` stack owns the packaged CLI and the optional supervised browser UI.
The package is kb's release bundle from
[popemkt/kb](https://github.com/popemkt/kb) (`pkgs/kb`, pinned like every
[direct release package](github-release-packages.md)). The pin follows kb's
newest release, stable or nightly (`v<next patch>-nightly.<UTC date>`, published
daily when main changed); `nvfetcher.toml` explains the ordering. kb deletes
nightlies after 14 days, so a nightly pin left that long stops downloading;
merge the updater's PR before then. Links into kb's docs name stable tags only,
since a nightly tag disappears with its release.
Both hosts enable the stack; only `popemkt-personal` enables `server.enable`.

## What a hosted UI serves

<!-- GAP [[01M56SQJF52DWN2T00D510BRQ3]]: kb links name the pinned release by hand. -->
A hosted UI serves a personal root, never a repository's `.kb`. A committed
store such as this repository's `.kb/nodes.jsonl` belongs to the Git
lifecycle: it changes through deliberate edits committed with the work they
describe. A live UI on it writes every page edit, and every kb upgrade's seed
nodes, into the checkout, and `rebuild` refuses to apply a dirty checkout.

The default root is the person's kb **home store**, kb's own personal root
([kb's DESIGN.md](https://github.com/popemkt/kb/blob/v0.3.0/DESIGN.md) →
Locations): `~/Library/Application Support/kb/home` on macOS and
`~/.local/share/kb/home` on Linux (`$KB_HOME` when set). It already holds the
person's location list, so the hosted page, `kb open` with no argument and
`kb locations` all name the same store. It is state, backed up and never
committed ([backup-strategy.md](backup-strategy.md) → kb Home Store). `kb ui`
creates it on first start and opens an existing one as it is, so nothing
initializes it ahead of time and nothing can clobber it.

Opening another location from the page (the Locations section, ⌘K "Open
location…", `location.open`) starts a separate `kb ui --port 0` on that
root, on a loopback port, and goes to its `http://127.0.0.1:<port>` URL. On a
server reached over the tailnet, that URL is the browser's own loopback, so
the page cannot follow it, and the started server is a plain loopback port
any local account can reach, the exposure the socket deployment below
removes. Opening the dotfiles' location does not itself dirty the checkout,
but every edit made on that page is written into it again. Work on a
repository's `.kb` with the CLI or a local `kb ui` instead, and commit the
result. Stop a server opened this way with `kill` on the pid its
`.kb/ui.json` names.

## shared-server

`hosts/shared-server/default.nix` places popemkt's home store as the
`my.services.kb` app, published as `svc:kb-popemkt`. It listens on the
owner-only socket `/run/kb-popemkt/kb.sock` rather than a port, because a
request carrying the UI's Origin acts as popemkt. The app's `package` is
`pkgs.kb`, run by store path, so a rebuild that moves the kb pin restarts it
(`configs/specs/app-service-contract.md`).

## Personal instance

<!-- GAP [[01M56SQJF52DWN2T00D510BRQ3]]: kb links name the pinned release by hand. -->
`hosts/popemkt-personal/default.nix` overrides the default root with
`/Volumes/Data/workspace/repos/_brain`, its own graph. The server listens on loopback port 9000. Its
`listenOrigin` supplies the target for `vpn.services.kb`; that service's
computed `publicOrigin` supplies the UI's `--public-origin` argument. The
route, request guard, and health check therefore derive their addresses from
the same declarations. The guard's contract is in
[kb's DESIGN.md](https://github.com/popemkt/kb/blob/v0.3.0/DESIGN.md).

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

Set `my.stacks.kb.enable` and `server.enable` on the intended host, and
`server.root` only to serve a root other than the home store. Set `server.port` when changing the loopback listener. For a reverse
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

The served root's `.kb` content remains user data. `kb ui` creates a missing
root as an empty store, so restore a root from backup before starting the
service on a new machine, or it starts empty beside the backup. Backup
ownership follows [backup-strategy.md](backup-strategy.md).
