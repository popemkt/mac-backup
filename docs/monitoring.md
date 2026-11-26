# Monitoring on shared-server

`my.stacks.monitoring` (`modules/stacks/monitoring/`, NixOS only) gives
shared-server two things:

- **Alerts** to your phone through the host's private ntfy
  ([ntfy.md](ntfy.md)), topic `host-attention`.
- **A dashboard**: [Beszel](https://beszel.dev), read-only metrics and unit
  states of this machine, on the tailnet.

Nothing here acts on the machine: no buttons, webhooks or restarts.
Both are switched on in `hosts/shared-server/default.nix`:

```nix
my.stacks.monitoring = {
  enable = true;
  alerts.enable = true;
  dashboard = {
    enable = true;
    login = "hoangng71299@gmail.com";
    ownerTags = [ "tag:personal-device" ];
  };
};
```

## Alerts

| Alert | When | Sent |
|---|---|---|
| `<unit> failed on shared-server` | any system service enters the failed state | once per unit per `failureCooldown` (1 h), with its result and last `journalLines` (15) journal lines; at most `burst.limit` (5) such alerts per `burst.window` (600 s) across all units |
| `<n> more services failed on shared-server` | failures beyond the burst limit | one summary listing them, at the next health check run |
| `Disk <mount> full` | a mounted filesystem is at least `thresholds.diskPercent` (90 %) full | once when it crosses, once `Recovered:` when it is back under |
| `Memory low` | available memory under `thresholds.memoryAvailablePercent` (10 %), or tasks stalled on memory at least `thresholds.memoryPressurePercent` (20 %) of the last minute (PSI `full avg60`) | once, then `Recovered:` |
| `Units stuck failed` | any unit failed for at least `thresholds.failedMinutes` (30) | once while the list is non-empty, then `Recovered:` |
| `Tailscale serve drift` | the node's `tailscale serve` config differs from the declared `my.stacks.vpn.nodeServe` entries (the MCP edge's public paths: a path added or missing, or Funnel on where it is not declared, or off where it is), or any foreground `tailscale funnel` session is public | once, with the difference, then `Recovered:` |
| `Keycloak sign-in errors` | at least `thresholds.signInErrors` (10) Keycloak error events (`LOGIN_ERROR`, `CODE_TO_TOKEN_ERROR`, ...) in `thresholds.signInWindowMinutes` (15) | once, with the commonest errors, then `Recovered:` |

The options are under `my.stacks.monitoring.alerts` (defaults in brackets);
`modules/stacks/monitoring/default.nix` describes each. To change a
threshold, set it in the host file, e.g.
`my.stacks.monitoring.alerts.thresholds.diskPercent = 85;`, and apply.

How it works:

- **Failed services.** A top-level drop-in, `service.d/10-monitoring-on-failure.conf`,
  gives every system service `OnFailure=monitoring-unit-failed@<name>.service`,
  so a service added later is covered with nothing to list. A notifier that
  fails (ntfy down, no token) never starts a notifier for itself: systemd
  already drops a template's dependency on its own instances, and the
  notifier's own drop-in clears `OnFailure=` again in case that heuristic
  changes. One incident often fails many units (or template instances) at
  once: past the burst limit a failure is queued, and the next health check
  run sends one summary of the queue. Notifiers take turns, each waiting at
  most 30 s for its turn (queued too if it cannot get one), and each run is
  capped at 2 min. A failure inside the
  cooldown is logged (`journalctl -u 'monitoring-unit-failed@*'`), not sent;
  a publish that failed records nothing, so the next failure tries again.
  User services (`systemctl --user`) are not covered.
- **Health checks.** `monitoring-health.service`, on a timer
  (`alerts.interval`, 5 min), keeps one file per check that is currently
  wrong under `/var/lib/monitoring/health/`. An alert goes out only when a
  check changes state. Its log: `journalctl -u monitoring-health`.
- **Publishing.** Both run as root, the one account besides popemkt that can
  open ntfy's owner-only socket, and get popemkt's host token
  (`~popemkt/.config/ntfy/token`) as a systemd credential (`LoadCredential=`):
  no permission on the socket or the token is widened. They publish with
  `ntfy-publish`, which the ntfy stack provides ([ntfy.md](ntfy.md)).
- **Keycloak.** The count reads Keycloak's journal for the WARN lines its
  default `jboss-logging` event listener writes under `org.keycloak.events`;
  the edge's realm keeps that listener, so no Keycloak setting changed.
  <!-- GAP [[01M89T0C8HKD2Q0F4A5KH07Z6D]]: proven only against synthetic log lines. -->

### Silence or turn off

- One noisy unit: add it to `alerts.ignoreUnits`
  (e.g. `[ "t3-work-relay.service" ]`); it never alerts, at once or as stuck.
- A unit already handled: `sudo systemctl reset-failed <unit>` clears it from
  the stuck list (and `Recovered:` follows).
- Everything for a while, without a rebuild:
  `sudo systemctl stop monitoring-health.timer` (health checks; back with
  `start`, or at the next boot). Failed-service alerts follow the drop-in and
  stop only with `alerts.enable = false`.
- On the phone: mute the `host-attention` subscription in the ntfy app.
- For good: `my.stacks.monitoring.alerts.enable = false;`.

## Dashboard

Open `https://beszel-shared-server.<tailnet-domain>` from one of popemkt's
devices: one signed in to Tailscale as `hoangng71299@gmail.com` (the phone,
an untagged laptop) or one of his Macs, tagged `tag:personal-device`
(`dashboard.ownerTags`). It shows CPU, memory, disks, network, temperatures
and the systemd units of shared-server, with history.

Anyone else sees nothing: another member's login, a machine with any other
tag, or a Mac still on its old tag (`tag:orca-host`, until the retag in
[tailscale.md](tailscale.md#retag-the-macs-once)). There is no password:
Beszel trusts the `Tailscale-User-Login` header, which its identity proxy
sets, never the caller:

- tailscaled's `tailscale serve` passes the caller's tailnet address as
  `X-Forwarded-For`, after dropping any `X-Forwarded-For` the caller sent
  (and every `Tailscale-User-*` header); it sends no login for a tagged
  device.
- The proxy (`modules/stacks/monitoring/identity-proxy`, Go, standard
  library only) drops every `Tailscale-*` header the request carries and asks
  `tailscale whois` about that one address. An untagged device gets its
  login; a device carrying a tag in `ownerTags` gets `dashboard.login`; any
  other device, an address tailscaled does not know, a Funnel request, or an
  `X-Forwarded-For` that is not exactly one address gets no identity, and the
  hub answers 401.

That is safe only because nothing else can send the proxy or Beszel a
request:

```
tailscaled (svc:beszel-shared-server, HTTPS)
  → /run/beszel-hub-proxy/beszel.sock   root only (0600, directory 0700)
  → beszel-hub-proxy                    names the viewer; joins the hub's network namespace
  → 127.0.0.1:8090 in that namespace    beszel-hub (PrivateNetwork=)
  → /run/beszel-agent/beszel.sock       beszel-agent (SSH, the hub's key)
```

The hub has a network namespace of its own, so its port is not on the host's
loopback, where any account could reach it and forge the header; only root
(tailscaled) can open the proxy's socket and so name the caller's address.
Whoever can put a tag in `ownerTags` on a machine (a tailnet admin, the
policy's `tagOwners`) can view the dashboard from it. Password
sign-in is off (`DISABLE_PASSWORD_AUTH`); the one user, `dashboard.login`, is
created on the hub's first start only, so a later change of `login` takes
effect after `sudo systemctl stop beszel-hub` and removing its state (below).
Beszel needs that login to be an email
address, so a GitHub login (`bytetum@github`) cannot be added as a viewer.
<!-- GAP [[01M89T0BSHY9AYJ1YJ3K4DNB6K]]: one viewer: bytetum cannot view it. -->
Beszel's own alerts are not used: the hub has no network to send them, and
the alerts above cover the same ground.

The Service needs its grant and auto-approver in
`configs/tailscale/policy.hujson` (both are there; CI checks them). The
grant names only popemkt's login and `tag:personal-device`, though the
wildcard grant still admits every member until the tightening pass
([tailscale.md](tailscale.md)); the identity proxy and Beszel's login check
are what stop them.

State: `/var/lib/private/beszel-hub` (the metrics history, the user, the
hub's SSH key; `/var/lib/beszel-hub` links to it). It is disposable and not
backed up ([backup-strategy.md](backup-strategy.md#monitoring-shared-server)):
losing it loses the history; the next start recreates the user and the key,
and the agent, which restarts with the hub, reads the new key.

## Your one-time steps

1. **ntfy token** (if not done yet): on shared-server, as popemkt, run
   `ntfy-setup` ([ntfy.md](ntfy.md)). Until `~/.config/ntfy/token` exists,
   the alert units are skipped (`Condition check resulted in ... skipped`),
   not failed.
2. **Phone**: the ntfy app subscribed to `host-attention`. ntfy has no
   tailnet listener yet (`expose = false`), so alerts wait on the server
   until the phone setup in [ntfy.md](ntfy.md#phone-setup-once-exposure-is-approved)
   is done.
3. **Dashboard**: nothing to do. `tailscale-reconcile.yml` creates
   `svc:beszel-shared-server` and applies its grant, and the host applies the
   change only after that run succeeded ([deploys.md](deploys.md)). If that
   run failed, `gh workflow run tailscale-reconcile.yml` once it is fixed.

## Tests

`checks.x86_64-linux.monitoring` (`modules/stacks/monitoring/tests.nix`)
boots one VM with the real units, an ntfy stand-in on the owner-only socket
(checking the token; its entry is not `ntfy`, so the alerts must call the
selected server's publisher) and a stub `tailscale`. It proves: a failed service
gives exactly one alert naming it, with its journal, and a second failure in
the cooldown gives none; a template instance alerts too; the notifier has no
`OnFailure=` and, with ntfy down, fails without starting a notifier for
itself, and the next failure after ntfy is back is sent; eight failures at once give
five alerts and one summary of the other three, and failures a run did not
send are sent by the next; a full disk alerts
once and recovers once; a path planted in the serve config alerts once and
recovers, and so does a foreground Funnel session; a burst of Keycloak error events alerts; Beszel answers on its
socket; with a stub `tailscale whois` for the caller's address, it admits
the owner's untagged device and a `tag:personal-device` Mac, and refuses no
caller, another tag, another member, an unknown address, the owner's login
forged in a header (with no caller, another tag or another member), a list
of addresses, two `X-Forwarded-For` headers and a Funnel request; it has
password sign-in off, is not on the host's loopback, refuses a non-root
account at its socket, and sees this machine through the agent. The proxy's
own Go test (run when it builds) covers the same cases against a stub hub.
The VM has no real tailscaled, so the proxy's call to tailscaled's local API
from its sandbox is first exercised on the host.

`checks.x86_64-linux.monitoring-queue` (`queue-check.nix`, no VM) races the
queue of failures waiting for a summary (a spool directory, one file per
failure, no lock): hundreds of notifiers queue while a health run keeps
sending, and every unit must be sent exactly once; an entry that cannot be
read is set aside in `queue/bad` (and the summary says so) while the rest
still go out, and a failed send deletes nothing.

```bash
nix build .#checks.x86_64-linux.monitoring -L
nix build .#checks.x86_64-linux.monitoring-queue -L
```
