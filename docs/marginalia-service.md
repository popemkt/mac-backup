# Marginalia service

[Marginalia](https://github.com/bytetum/marginalia) is bytetum's reading
library: one Rust binary serving a web page at `/`, a REST API, and an MCP
endpoint at `/mcp`, over an embedded SurrealDB directory plus a blob store.
This repository installs its release and places one instance on
`shared-server`; the app's code, build and configuration schema stay in its
own repository (`configs/specs/app-service-contract.md`).

## The package, pinned by hand

`pkgs/marginalia` fetches the release tarball
`marginalia-<version>-x86_64-linux.tar.gz` from
`github.com/bytetum/marginalia` and installs its `bin/marginalia`, a fully
static musl binary (no patchelf). Its platform is `x86_64-linux` only, so the
flake lists it under no other system's `packages` or `checks`.

Unlike every other [direct release package](github-release-packages.md), it is
not in `nvfetcher.toml` and has nothing under `_sources/`: no bot moves it.
The `version` and `hash` at the top of `pkgs/marginalia/default.nix` are
edited together by hand (the file says how). That is safe because
bytetum/marginalia never prunes its releases, nightlies included; kb's pin
needs a bot because kb deletes nightlies after 14 days.

## shared-server

`hosts/shared-server/default.nix` places it as `my.services.marginalia-bytetum`
(`app = "marginalia"`, owner `bytetum`), published as
`svc:marginalia-bytetum`, so it is at
`https://marginalia-bytetum.<tailnet-domain>`. The unit is
`app-marginalia-bytetum`, running `marginalia serve` as bytetum with `HOST`
and `PORT` set by `my.services`: loopback port 7879. The app's `package` is
`pkgs.marginalia`, run by store path, so a rebuild that moves the pin
restarts it.

It listens on a loopback port, not an owner-only socket: the app is
authenticated by its own bearer token, and the Service's HTTPS needs a target
either way. Any account on the host can reach the port, and none can use it
without the token. Its policy grant is for tailnet members, as for the kb
Services; the token is what stops them.

| Setting | Value |
|---|---|
| `MARGINALIA_DATA` | `~/.local/share/marginalia-nix/data` (`db/` and `blobs/`; the app creates it) |
| `MARGINALIA_TOKEN_FILE` | `~/.config/marginalia/token` |
| `LLM_*`, `FIRECRAWL_*` | unset: the built-in agent is off until a key file is declared |

The embedded database admits one process per data directory. This instance's
directory is its own; the hand-made systemd user unit `marginalia` still
serves `~/.local/share/marginalia/data` on `100.103.153.13:7878`, and nothing
here touches it.

### Token

The token is machine state: it is never declared or committed, and this
repository has no encrypted-secrets mechanism (the only secret path is
`scripts/shared-server-secrets`, for bootstrap passwords). The unit refuses to
start without the file, so create it as bytetum **before** the first
`rebuild` that includes this service, or the unit fails and retries every 10
seconds until it exists:

```bash
install -d -m 700 ~/.config/marginalia
( umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > ~/.config/marginalia/token )
```

To keep the legacy instance's token, so existing clients (Hermes profiles,
Claude Code) need no change after a switchover, write that value to the same
file instead and check only its size, never its content.

An agent must not read or print the file.

### Checking it

`GET /health` answers without a token. `my.services` has no health-check
option, so this is by hand:

```bash
curl -s http://127.0.0.1:7879/health
curl -s https://marginalia-bytetum.<tailnet-domain>/health
```

## Switching data over

Not part of the declaration. Stop the legacy user unit first (one process per
data directory), then either move `~/.local/share/marginalia/data` to the new
data directory or restore a `GET /export` snapshot into it with
`marginalia import` (the app's README → Backup & restore).

## Backup

State, and a regular backup concern ([backup-strategy.md](backup-strategy.md) →
Marginalia Library).
