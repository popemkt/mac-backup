# Tailscale

## Ownership

The repository owns the intentional Tailscale configuration that can be
reviewed and reproduced safely:

- `flake.nix` owns the MagicDNS tailnet domain used by hosts and clients.
- `hosts/*` and `modules/stacks/vpn/*` own local app installation and
  `tailscale serve` declarations. Each host also records the tags its machine
  record carries in `my.stacks.vpn.tags`; assigning them stays manual.
- `flake.nix` gathers every host's declared Services, with the host and its
  tags, into one output: `nix eval --json .#tailscaleServices`.
- `configs/tailscale/policy.hujson` owns grants, tag ownership, service host
  auto-approval, and Tailscale SSH authorization.
- `.github/workflows/tailscale-policy.yml` tests policy changes on pull
  requests and applies them after they reach `main`.

Device enrollment, node keys, OAuth secrets, user membership, and live device
inventory are mutable control-plane state. Do not commit them to this repo.

## One-Time GitOps Enrollment

The workflow uses Tailscale workload identity federation, so it does not need a
long-lived API key. The current tailnet is already enrolled with this trust:

| Setting | Value |
|---|---|
| GitHub repository | `popemkt/mac-backup` |
| Credential description | `GitHubActionsPopemktMacBackup` |
| Credential type | OpenID Connect |
| Issuer | GitHub |
| Subject | `repo:popemkt/mac-backup:*` |
| Scope | Policy File, Write (the console includes Read) |

The subject admits workflows from this repository only. Tailscale exchanges
each GitHub-issued OIDC token for short-lived policy access; there is no OAuth
client secret or reusable Tailscale API key.

### Recreate The Trust

This is the complete manual bootstrap if the credential, tailnet, or GitHub
repository is replaced:

1. In the Tailscale admin console, open **Settings > Trust credentials**.
2. Select **Credential**, then **OpenID Connect**.
3. Use the alphanumeric description `GitHubActionsPopemktMacBackup`.
4. Select the **GitHub** issuer. Leave its generated issuer URL unchanged.
5. Set the subject to `repo:popemkt/mac-backup:*`. Leave audience and custom
   claims empty.
6. Continue to scopes and select **Policy File > Write** only. The console
   automatically includes Policy File Read.
7. Generate the credential and keep the result open until both the Client ID
   and Audience have been copied.
8. In GitHub, open **popemkt/mac-backup > Settings > Secrets and variables >
   Actions**, then create these repository secrets:

| Secret | Value |
|---|---|
| `TS_OAUTH_ID` | federated identity client ID |
| `TS_AUDIENCE` | federated identity audience |
| `TS_TAILNET` | tailnet name shown beside the Tailscale logo |

The equivalent CLI enrollment prompts for each value without putting it in the
repository:

```bash
gh secret set TS_OAUTH_ID --repo popemkt/mac-backup
gh secret set TS_AUDIENCE --repo popemkt/mac-backup
gh secret set TS_TAILNET --repo popemkt/mac-backup
```

Verify the complete path rather than assuming that secret presence means the
trust works:

```bash
gh workflow run tailscale-policy.yml --repo popemkt/mac-backup --ref main
gh run list --repo popemkt/mac-backup --workflow tailscale-policy.yml --limit 1
gh run watch --repo popemkt/mac-backup <run-id> --exit-status
```

The workflow stays green but skips synchronization while all three are absent.
A partial configuration fails loudly. After enrollment, pull requests validate
the policy and pushes to `main` apply it automatically.

Console policy edits are emergency changes, not durable configuration. The next
successful apply replaces them with `configs/tailscale/policy.hujson`. If an
apply fails, Tailscale keeps the previous live policy; inspect it with
`gh run view --repo popemkt/mac-backup <run-id> --log-failed`.

## Services And Direct Ports

The personal host publishes three HTTPS Service identities. Their tagged host is
automatically approved by policy, but creating each Service identity the first
time remains a Tailscale control-plane operation.

| Service | Tailnet URL | Loopback target | Purpose |
|---|---|---|---|
| `svc:cognee` | `https://cognee.<tailnet-domain>` | `127.0.0.1:8088` | Cognee UI and API gateway |
| `svc:kb` | `https://kb.<tailnet-domain>` | `127.0.0.1:9000` | Home kb UI |
| `svc:adhoc` | `https://adhoc.<tailnet-domain>` | `127.0.0.1:9001` | Temporary HTTP apps |

The personal host's kb lifecycle and origin-aware readiness check are declared
by the kb stack; see [kb-service.md](kb-service.md).

The ad hoc endpoint is independent of kb. Start any temporary HTTP server on
`127.0.0.1:9001`; Tailscale serves it at the ad hoc HTTPS name for allowed
tailnet members. It has no backend while that port is unused.

The shared server (`shared-server`, tagged `tag:shared-server`) publishes one
T3 Code server per person. Each target is derived from that instance's port in
`hosts/shared-server/default.nix`; both people may reach both. It also
publishes each person's personal kb (their home store; `my.services` apps, below) and an ad hoc
endpoint for popemkt's temporary HTTP apps, like the personal host's.

| Service | Tailnet URL | Local target | Purpose |
|---|---|---|---|
| `svc:t3-popemkt` | `https://t3-popemkt.<tailnet-domain>` | `127.0.0.1:3773` | popemkt's T3 Code server |
| `svc:t3-bytetum` | `https://t3-bytetum.<tailnet-domain>` | `127.0.0.1:3774` | bytetum's T3 Code server |
| `svc:kb-popemkt` | `https://kb-popemkt.<tailnet-domain>` | `unix:/run/kb-popemkt/kb.sock` | popemkt's kb home store (`my.services.kb`; a socket only popemkt and root can reach) |
| `svc:kb-bytetum` | `https://kb-bytetum.<tailnet-domain>` | `unix:/run/kb-bytetum/kb.sock` | bytetum's kb home store (`my.services.kb-bytetum`, `app = "kb"`; a socket only bytetum and root can reach) |
| `svc:adhoc-popemkt` | `https://adhoc-popemkt.<tailnet-domain>` | `127.0.0.1:9001` | popemkt's temporary HTTP apps |
| `svc:bb-popemkt` | `https://bb-popemkt.<tailnet-domain>` | `127.0.0.1:38886` | popemkt's bb server (`my.services.bb`; its API is unauthenticated) |

A native app placed with `my.services.<app>` on a NixOS host is exposed the
same way, as `svc:<app>-<owner>` (`<app>` is the entry's `app`, its name
unless set) targeting its loopback port, or its Unix
socket when it sets `socket`, unless it sets `expose = false`. Prefer a socket
for an app that trusts whoever reaches it: any account on the host can connect
to a loopback port, but only the owner and root (tailscaled) can reach the
owner-only socket directory. Like any Service it needs a grant and an
`autoApprovers.services` entry for the host's tag; the gate and CI fail until
both exist.

### Ad Hoc Apps

`adhoc` (installed for every person on every host, by the vpn stack) puts a
local web app on the tailnet for a while, two ways:

| Command | Where it appears | Use it for |
|---|---|---|
| `adhoc <port> [--https=<p>]` | `https://<this-machine>.<tailnet-domain>` (`:<p>` for a second app) | an app running on this machine, reachable from the machine's own name |
| `adhoc --shared <port>` | `https://adhoc-popemkt.<tailnet-domain>` | a stable name that survives which machine the app runs on |

`adhoc <port>` runs `tailscale serve --bg` against `127.0.0.1:<port>` and prints
the URL; HTTPS ports are 443 (default), 8443 and 10000. It refuses to replace an
HTTPS port that is already served. `adhoc ls` shows what is published,
`adhoc off --https=<p>` removes one entry, and `adhoc off` removes every entry
of the machine's own. It deliberately avoids `tailscale serve reset`, which
empties the whole serve config and would take the declared Tailscale Services
down with it. These entries live only in tailscaled's state; a rebuild does not
declare or remove them.

`adhoc --shared <port>` runs `ssh -N -R 9001:localhost:<port>
popemkt@shared-server` in the foreground (Ctrl-C ends it), so
`svc:adhoc-popemkt` serves your port. Port 9001 is read from shared-server's
`adhoc-popemkt.target`, not repeated. It first checks that nothing already
listens on 9001 there and refuses, naming the holder (a systemd unit, say), if
something does. On shared-server itself it only says to serve on 9001 directly.

Two things it relies on:

- Per-machine serve is reached through the policy's final wildcard grant
  (`"src": ["*"], "dst": ["*"]`); no grant names these per-machine HTTPS ports.
  Removing the wildcard breaks them until a narrower grant exists (see the
  `GAP` node in `.kb/nodes.jsonl`). The shared endpoint has its own grant.
- On NixOS `tailscale serve` needs root or tailscaled's one operator.
  `my.stacks.vpn.operator` sets it (`popemkt` on shared-server) through
  `tailscale set --operator`, which a rebuild applies; until then run `adhoc`
  there as root. The macOS app needs nothing, and `adhoc` uses its CLI
  (`/usr/local/bin/tailscale`), not a second daemon.

### First Tailnet Or Replacement Host

The remaining manual control-plane steps are:

1. Sign the machine into Tailscale from the menu bar. Device identity and node
   keys must never be committed.
2. Nothing to create by hand for Services: on every push that can change a
   declaration, the `sync` job of `.github/workflows/tailscale-services.yml`
   creates or updates every Service in the flake's `tailscaleServices` (keeping
   each one's existing addresses) and warns about Services nothing declares,
   deleting none. When it creates one, it reapplies the policy (step 3) itself.
   It needs the trust credential's `all` scope.
3. Apply the tracked policy through the GitHub workflow so that
   `tag:home-server`, its owner, grants, and the Service auto-approver exist.
   Service auto-approvers are resolved against existing Service identities, so
   rerun this workflow whenever a Service was created after the last policy
   apply.
4. Open **Machines**, select the home server (`popemkt-personal`), edit its tags, and assign
   `tag:home-server`.
5. Rebuild the host. The `tailscale-services` launchd job advertises
   `svc:cognee`, `svc:kb`, and `svc:adhoc`; policy automatically approves the tagged host.
6. Confirm `tailscale status --json` reports the tag, `services/cognee`, and
   `services/kb`, and `services/adhoc`; then test the active HTTPS origins from
   another tailnet device.

For a replacement host in the same tailnet, the Service and policy already
exist; repeat steps 1, 4, 5, and 6.

Orca Mobile does not need another Service identity or reverse proxy. It talks
directly to the personal host on TCP 6768 through MagicDNS:

```text
ws://popemkt-personal.<tailnet-domain>:6768
```

The policy explicitly grants tailnet members access to that port on
`tag:orca-host`.

### Orca Mobile Pairing

Pairing codes are bearer credentials containing a device token and public key.
Never commit one, paste one into an issue or agent transcript, or reuse a code
after exposure.

1. Put the phone on the same tailnet and confirm it can resolve
   `popemkt-personal.<tailnet-domain>`.
2. In desktop Orca, open **Orca Mobile**. Choose **Get started** or **Pair
   another device**, continue to **Pair this**, and use local-network pairing.
3. Generate the code. The desktop may encode the current Tailscale IP; that is
   valid, but the durable endpoint is
   `ws://popemkt-personal.<tailnet-domain>:6768`.
4. If an agent rewrites the code, it must base64url-decode only the `code`
   payload, replace only the JSON `endpoint`, preserve `v`, `deviceToken`,
   `publicKeyB64`, and `scope`, then base64url-encode it without padding.
5. Put the resulting `orca://pair?code=...` URI directly on the user's local
   clipboard or show Orca's QR. Validate only the scheme, endpoint, scope, and
   presence of token/key; never print the token in logs.
6. Paste the URI into Orca Mobile's **Pair Desktop** flow. Regenerate the code
   from desktop Orca if pairing fails or if the code may have been exposed.

Before handing off a code, verify the listener without revealing credentials:

```bash
nc -vz popemkt-personal.<tailnet-domain> 6768
```

## SSH

Tailscale SSH needs no keys or sshd: tailscaled answers port 22 on the
tailnet address and logs the caller in by Tailscale identity, as the account
the policy's `ssh` rules allow.

| Host | How | Who, as whom |
|---|---|---|
| `shared-server` | `my.stacks.vpn.ssh = true` (`tailscale set --ssh`) | popemkt's account and his tagged Macs as `popemkt`; `bytetum@github` as `bytetum`; nobody as root |
| `popemkt-personal`, `popemkt-work` | not reachable | the Tailscale app cannot host Tailscale SSH on macOS; the stack asserts against it |

The Macs have two ways in, neither taken yet: replace the app with the open
source `tailscaled` (then `vpn.ssh` works there too, at the cost of the menu
bar app), or turn on Remote Login with keys in `authorized_keys`.

Tagged devices connect as their tags, not as their former owner, so popemkt's
Macs appear in the shared-server rule as `tag:home-server` and
`tag:orca-host`. Rules use `accept`: `check` asks for a browser sign-in every
12 hours, which agents cannot do. `sshTests` in the policy pin both people's
access, and the policy workflow runs them before applying.

## Current Compatibility Grant

The live tailnet started from Tailscale's unrestricted default policy. The
tracked policy preserves that wildcard grant so adopting GitOps cannot silently
break unrecorded traffic. The explicit Orca and Cognee grants are therefore
documentation today and become enforcement when the wildcard is removed.

Before removing it, inventory remaining machine-to-machine, subnet, exit-node,
SSH, and shared-device flows and add a policy test for each intended path.

### TODO: tightening pass

The tightening pass has two pieces, in order.

**1. Give Orca its own tag.** Completed on 2026-08-31. The policy grants
`tcp:6768` to `tag:orca-host`, and both Macs carry that tag.

Assigning a tag also removes a device's user owner, and `autogroup:self` does
not match tagged devices. Confirm whether Tailscale SSH into `popemkt-work` is
used before changing the tag; if so, the `ssh` block needs widening in the same
change.

**2. Remove the wildcard.** Flows observed on 2026-07-28, and whether a grant
already covers them:

| Flow | Covered |
|---|---|
| Phones/tablet to either Mac, `tcp:6768` (Orca Mobile) | yes |
| `popemkt-work` to `svc:cognee`, `tcp:443` | yes |
| Any member to `svc:kb`, `tcp:443` | yes |
| Any member to `svc:adhoc`, `tcp:443` | yes |
| Member to own node, SSH | yes, `ssh` block |
| popemkt, bytetum, popemkt's Macs to `shared-server`, `tcp:22` (Tailscale SSH) | yes |
| `ControlCe` on `*:5000` and `*:7000` (AirPlay) | no — LAN feature, expected to be denied |
| `rapportd` on `*:57212` (Continuity) | no — LAN feature, expected to be denied |
| Mac-to-Mac file/screen sharing, exit node, subnet routes | unknown, needs a decision |

The last row is the blocker: those cannot be observed from a single host. Decide
them before the wildcard goes, and add a policy test for each path kept.

## What Is Not Exported

The policy file is the primary reproducible Tailscale artifact. DNS resolver
settings, user membership, device approvals, key expiry, and account-level
preferences remain external state managed in the control plane.

Known device addresses used by host-local rules are different: the stable
Tailscale IPv4 inventory is declared in `flake.nix` under
`my.stacks.vpn.knownDevices`, so every Darwin host consumes the same map.

This table is the manual-state inventory agents should check before inventing a
new configuration path:

| External state | Where it lives | Recreate/verify |
|---|---|---|
| Tailnet account and membership | Tailscale | Admin console **Users** |
| `tag:home-server` assignment | Tailscale machine record | **Machines > Edit tags** |
| `tag:orca-host` assignment | Tailscale machine record | **Machines > Edit tags** |
| Service identities (`svc:*`) | Tailscale, created from this repository | `.github/workflows/tailscale-services.yml` on push, from the flake's `tailscaleServices`; verify in Admin console **Services** |
| GitHub OIDC trust credential (scope `all`: the Services API needs more than Policy File) | Tailscale | **Settings > Trust credentials** |
| Enrollment values | GitHub Actions secrets | `gh secret list --repo popemkt/mac-backup` |
| Policy, tag owner, grants, SSH, auto-approver | This repository | `configs/tailscale/policy.hujson` |
| Known device IPv4 addresses | This repository | `flake.nix` → `my.stacks.vpn.knownDevices` |
| Local app and Service advertisement | This repository | Nix VPN stack and host declaration |
| DNS/account preferences | Tailscale | Admin console **DNS** and **Settings** |
