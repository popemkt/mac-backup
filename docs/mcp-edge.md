# The OAuth edge for kb's MCP (tailnet only)

popemkt's kb store, reachable from Gemini and Claude as an MCP server
behind Google sign-in, published on the tailnet only. Phase 1b of the design
in popemkt/kb `docs/research/2026-11-24-public-mcp.md` (§6 row 1b, B1–B5).
Funnel (public reach) is phase 1c and is not declared anywhere yet.

Code: `modules/stacks/mcp-edge/` (the edge) and
`modules/stacks/kb/remote-mcp.nix` (the store's MCP server). Host switch:
`mcpEdge` in `hosts/shared-server/default.nix`.

## What runs

```
tailscaled  https://shared-server.<tailnet>/  (vpn nodeServe, one target)
  → front    nginx 127.0.0.1:4190   the public allow-list; anything else 404
      /mcp                            → oauth2-proxy 127.0.0.1:4180 → /run/kb-edge/mcp.sock
      /.well-known/… (PRM, AS meta)   static files, generated from Nix
      /realms/kb/{auth,token,certs}, /realms/kb/broker/google/…,
      /realms/kb/login-actions/, /resources/  → Keycloak 127.0.0.1:8180
```

| Unit | Runs as | What it does |
|---|---|---|
| `nginx` (vhost `mcp-edge`) | nginx | The allow-list (B4). Strips cookies from `/mcp`. Adds `WWW-Authenticate: Bearer resource_metadata=…` to a 401 |
| `keycloak` + `postgresql` | dynamic `keycloak` | Realm `kb`: static clients `gemini` and `claude`, Google as the only way in. Drops and re-imports its database on every start |
| `mcp-edge-oauth2-proxy` | `kb-edge` | Lets a request through only with a Keycloak access token whose `aud` is `https://<host>/mcp`, whose `iss` is the public issuer, and whose verified email is listed. Loopback egress only |
| `kb-remote` | `kb-edge` | `kb --root <store> mcp --listen unix:/run/kb-edge/mcp.sock`, `KB_VIA=mcp-remote`, in an allow-list sandbox |
| `kb-remote-sandbox-check` | `kb-edge` | The same sandbox, probed from inside. `kb-remote` requires it to pass |
| `kb-remote-store-acl` | root | ACLs so `kb-edge` and the owner both read and write the store |
| `mcp-edge-secrets` | root | Generates client secrets. Fails, naming the files, while the Google client is missing |

Two choices differ from the design:

- **Keycloak, not Dex (B3).** See below.
- **A front, not tailscaled path mounts (B4).** tailscaled publishes one target, and the allow-list is the front's route table. Both run on loopback, so the VM test runs the allow-list under the real units. Funnel in phase 1c publishes the same single target.

## B3: why Keycloak

B3 needs an access token whose audience is the MCP resource, different from
the ID token. Dex 2.45.1, the version nixpkgs ships, cannot issue one:

- `server/oauth2.go:268`: `newAccessToken` *is* `newIDToken(…, storage.NewID(), "", connID)`, so the access token is an ID token for a random "access token".
- `server/oauth2.go:283-304,391-395`: both tokens get the audience from `getAudience`, which is the client id, or the cross-client peers. There is no separate access-token audience and no `typ`.
- No RFC 8707 `resource` parameter is parsed anywhere in `server/`.

So the access token and the ID token carry the same claims, and oauth2-proxy
cannot accept one and refuse the other. Following §6, the broker is Keycloak
26.7.4. An `oidc-audience-mapper` on each client puts `https://<host>/mcp`
into the access token only (`access.token.claim=true`,
`id.token.claim=false`). oauth2-proxy 7.15.4's `--client-id` is set to that
URI, and it is the only audience it accepts
(`pkg/providers/oidc/verifier.go:32-35`). No Keycloak client has that id, so
no ID token can carry it. The VM test checks each case.

Keycloak is fenced (B4): its admin console, admin API and account console
are disabled at build time (`features-disabled`). There is no admin user and
no management port, and its cache is `local`, so no JGroups ports. The front
routes only the sign-in paths above. Keycloak's own discovery documents are
not routed: the static ones list only code + S256, client secrets, and no
registration, device, userinfo or logout endpoint.

**Every Keycloak start is a fresh realm.** The database is dropped and the
realm re-imported from Nix with the secrets substituted. Config changes
apply on restart, and nothing in the database needs a backup. The cost: a
restart (reboot, upgrade) signs every connector out, and you sign in again
in Gemini and Claude.

## Why the secret

Anyone can add this URL as a connector in *their own* Gemini or Claude and
send you the sign-in link. The vendors use one callback for every user, so
the redirect check cannot tell their connector from yours. Only your
connector holds the client secret, and without it the code you approved
cannot be redeemed. The VM test's phishing check is exactly this. The
approval screen ("gemini wants access") is a second, weak layer.

## One-time steps (the owner)

1. **Google OAuth client.** In Google Cloud console → APIs & Services → Credentials, create an OAuth client ID of type *Web application* with the authorized redirect URI `https://shared-server.taild98079.ts.net/realms/kb/broker/google/endpoint`. On the OAuth consent screen, add your account as a test user, or publish the app; it asks only for `openid email profile`.
2. **Machine-state files** on shared-server, root-only, never committed:

   ```bash
   sudo install -d -m 0700 /var/lib/mcp-edge/secrets
   sudo sh -c 'umask 077; cat > /var/lib/mcp-edge/secrets/google-client-id'      # paste, Ctrl-D
   sudo sh -c 'umask 077; cat > /var/lib/mcp-edge/secrets/google-client-secret'  # paste, Ctrl-D
   ```

3. **Turn it on:** `mcpEdge = true;` in `hosts/shared-server/default.nix`, once kb's pin has `kb mcp --listen`. Commit, push, `rebuild`. The first start writes `client-gemini-secret` and `client-claude-secret` into the same directory.
4. **Connect.** URL `https://shared-server.taild98079.ts.net/mcp`. Client ID `gemini` (or `claude`). Client secret: `sudo cat /var/lib/mcp-edge/secrets/client-gemini-secret`. On the tailnet only until phase 1c, so a vendor's cloud cannot reach it yet.

### Gemini's redirect

Google publishes Gemini's redirect only as a pattern
(`https://oauth-redirect.googleusercontent.com/r/*`), and Keycloak needs it
exact. `clients.gemini.redirectUris` starts empty, so Gemini is refused. The
first sign-in shows "Invalid parameter: redirect_uri", and Keycloak logs the
URI it refused (the VM test checks that it does):

```bash
journalctl -u keycloak | grep -o 'redirect_uri="[^"]*"' | tail -n 1
```

Add that URI to `clients.gemini.redirectUris` in the host file, then commit,
push and `rebuild`. If it changes from one connection to the next, a
trailing `*` would be needed. Keycloak allows that, but the design (§7) asks
for that decision to be the owner's.

## Off switch

- **Declared:** `mcpEdge = false;` in the host file, then `rebuild`. That removes the units, the `kb-edge` account's processes and the tailnet entry (the reconcile runs `tailscale serve --https=443 off`). `app-kb` is untouched.
- **Immediate:** `sudo systemctl stop mcp-edge-oauth2-proxy kb-remote keycloak`, or `sudo tailscale serve --https=443 off`. The next `rebuild` restores the declared state.

## Rotate a client secret

```bash
sudo rm /var/lib/mcp-edge/secrets/client-gemini-secret
sudo systemctl restart mcp-edge-secrets keycloak
sudo cat /var/lib/mcp-edge/secrets/client-gemini-secret   # paste into Gemini
```

The restart also revokes every token (next section).

## Revoke every token

`sudo systemctl restart keycloak`. The realm is rebuilt with new signing
keys, so every access token (5 minutes long), refresh token and session dies.
oauth2-proxy picks up the new keys on its own, without a restart. Every
connector has to sign in again.

## Tests

`checks.x86_64-linux.mcp-edge` (`modules/stacks/mcp-edge/tests.nix`) is a
NixOS VM with app-kb (real kb), kb-remote, oauth2-proxy, Keycloak and the
front. Dex's password connector stands in for Google, and an nginx TLS
terminator stands in for tailscaled. It checks:

- **Tailnet only:** nothing listens beyond loopback. Keycloak's admin API is gone even on loopback.
- **Phishing:** a sign-in started as `gemini` and redeemed with a wrong secret, or with none, gets no token.
- **Grants:** no PKCE, plain PKCE, a missing verifier, implicit, password and client-credentials grants are all refused. An unregistered redirect is refused and logged.
- **B3:** the owner's access token has `aud` = the resource; the ID token does not. Each of these is refused at `/mcp`:
  - the ID token;
  - a client-id audience or a foreign audience;
  - a foreign key, a foreign issuer or a wrong `iss`, the last signed with Keycloak's own key (B5);
  - an expired token or an unverified email;
  - a second identity's token (403);
  - a genuine oauth2-proxy session cookie, minted with the running secret: oauth2-proxy itself accepts it, but the front never passes it on.

  A forged token that is right in every claim passes, and the owner's real tokens pass and list the tools.
- **B4:** about 40 paths outside the allow-list return 404, including `/oauth2/*`, `/ping`, the admin console, the master realm, the account console, and the userinfo, device, introspection, registration, logout and health endpoints, plus traversal spellings.
- **B1:** the socket is `kb-edge kb-edge 0600` in a `0700` directory. A process of the owner's cannot connect. Writes through app-kb and through kb-remote interleave, each side sees the other's, and every file stays read-write for both after kb's atomic replaces.
- **B2:** `kb-remote-sandbox-check` passes inside the unit:
  - `/` lists only the binds and the API filesystems, and `/run` holds only `kb-edge`;
  - other stores' sockets, `/run/tailscale`, `/run/dbus`, `/run/user` and `/etc` are absent, and the owner's home shows only the way down to the store;
  - TCP, UDP, netlink and a host abstract socket all fail;
  - writes outside the store and state fail.

  The same probe run outside the sandbox fails.
- **B5:** oauth2-proxy has `IPAddressDeny=any` and `IPAddressAllow=localhost`. After a Keycloak restart, which rotates the keys, a new token passes and an old one fails, with no oauth2-proxy restart.

kb-remote runs `kb mcp --listen` built from popemkt/kb `feat/mcp-listen`
(commit bdde5455, kb's own flake, locked by narHash) until kb's pin ships
it; app-kb runs the pinned kb on the same store. Gap
`01M86QT0G81VG04JQ294EXACE2` says how to switch.
