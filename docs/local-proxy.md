# Local Proxy

`my.stacks.local-proxy` serves loopback apps at `https://<site>.localhost`
on macOS, under a root CA the Mac makes for itself. All traffic stays on the
machine:

- a `.localhost` name always resolves to loopback (RFC 6761). macOS and every
  browser answer it themselves, without DNS or `/etc/hosts`.
- Caddy listens only on `127.0.0.1:443` and `[::1]:443`.
- no public CA, domain, DNS record or tunnel is involved.

The code lives in `modules/stacks/local-proxy/`; its header explains the
design. CA state and backup: [backup-strategy.md → Local Proxy CA](backup-strategy.md#local-proxy-ca).

## Add a site

In `hosts/<hostname>/default.nix`:

```nix
my.stacks.local-proxy = {
  enable = true;
  sites.my-app.target = "http://127.0.0.1:3000";   # https://my-app.localhost
};
```

The attribute name is the DNS label. The target must be a loopback HTTP
origin. The proxy passes `Host` and `Origin` through untouched, so an app
with a Host/Origin guard has to admit the site's address itself. Read that
address from `my.stacks.local-proxy.sites.<name>.origin` instead of
repeating it. `rebuild` applies the change and restarts the daemon. The
first rebuild also creates the CA.

## Enroll the CA (once per CA)

```bash
system-setup enroll local-proxy-trust
```

This runs `security add-trusted-cert -r trustRoot` on
`/var/db/local-proxy/ca/root.crt` in your login keychain's trust settings,
and macOS asks for your password. `system-setup status` reports
`local-proxy-trust` as ready afterwards. Enroll again only when the CA is
new: its key was lost, or it had under a year left and the daemon replaced
it. The status check shows `action-needed` when that happens.

Safari, Chrome and other apps that use the macOS trust store accept the
sites once the CA is enrolled. Firefox uses its own store. It reads roots
you added to macOS when `security.enterprise_roots.enabled` is on (the
default on macOS); otherwise import `root.crt` in its certificate settings.

## Readiness

`system-setup status` runs these checks:

| Check | Proves |
|---|---|
| `local-proxy-process` | `system/org.nixos.local-proxy` runs the declared command and is the only listener on port 443, exactly at `127.0.0.1` and `::1` (never the wildcard) |
| `local-proxy-backup-exclusion` | Time Machine excludes `/var/db/local-proxy`, the CA state |
| `local-proxy-trust` | macOS trusts the CA (`security verify-cert`) |
| the app's own check, e.g. `kb-ui-local` | the site answers over HTTPS through the macOS trust store, as a browser would; the host makes it depend on `local-proxy-trust` |

## Troubleshooting

- **Browser says the certificate is not trusted.** Run
  `system-setup status`. If `local-proxy-trust` needs action, enroll the
  CA. If you enrolled an older CA, open Keychain Access, find the
  "Local Proxy CA (<host>)" entries under Certificates, delete the stale
  one, and enroll again.
- **Connection refused, or `local-proxy-process` fails.** Run
  `sudo launchctl print system/org.nixos.local-proxy` and read
  `/var/log/local-proxy.log`. If another process holds port 443, the check
  names its pid.
- **A 403 from the app.** The app's guard does not admit the site's origin.
  Declare the origin in that app's config (for kb, `kb.server.aliasOrigins`).
- **A 502.** The app is not listening at the site's `target`.

## kb on the work Mac

kb serves the same graph at two addresses:

- `https://kb-work.<tailnet>.ts.net`: the Tailnet Service
  (`vpn.services.kb-work`), reachable from any tailnet device. This is kb's
  public origin (`kb.server.publicOrigin`). Links that leave the page name
  it: calendar backlinks and the Google OAuth redirect.
- `https://kb-work.localhost`: this proxy (`local-proxy.sites.kb-work`),
  reachable only on the Mac. It is a `kb ui --alias-origin`
  (`kb.server.aliasOrigins.local`).

kb's guard admits both addresses exactly. Navigation, the WebSocket and the
API stay on the address the page was opened at. Connecting Google Calendar
is the one exception: Google sends you back to the public origin, and the
routines setup page warns you before you start.

## Validation

`nix build .#checks.aarch64-darwin.local-proxy-check` runs the real CA
script and Caddy configuration on a high port in front of a test app. CI
runs it on its macOS runner as part of `nix flake check`. It asserts:

- the CA is root-only, constrained to `localhost`, made once, and replaced
  when broken;
- Caddy listens on loopback only, with no admin endpoint and no HTTP listener;
- `Host` and `Origin` reach the app unchanged;
- WebSocket upgrades and server-sent events pass through, and events are not
  buffered;
- an undeclared name gets no certificate, and the CA cannot vouch for a DNS
  name outside `localhost` or for any IPv4 or IPv6 address. Both openssl and
  macOS's own verifier (`security verify-cert`) must refuse these.
- a root made without those constraints is replaced.
