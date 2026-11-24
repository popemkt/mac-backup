# The OAuth edge for kb's MCP

popemkt's kb store, reachable from Gemini and Claude as an MCP server
behind Google sign-in. It is published on the tailnet (phase 1b) and, with
its own switch, on the internet through Tailscale Funnel (phase 1c). The
design is popemkt/kb `docs/research/2026-11-24-public-mcp.md` (§6 rows 1b
and 1c, B1–B5).

Code: `modules/stacks/mcp-edge/` (the edge) and
`modules/stacks/kb/remote-mcp.nix` (the store's MCP server). Host
switches, in `hosts/shared-server/default.nix`: `mcpEdge` (the edge, on the
tailnet) and `mcpFunnel` (the same paths, on the internet; off by default).

## What runs

```
tailscaled  https://shared-server.<tailnet>/  (vpn nodeServe; Funnel with mcpFunnel)
            mounts only the allow-list's 18 paths below; any other path is not served
  → front    nginx 127.0.0.1:4190   the same allow-list, exact; anything else 404
      /mcp                            → oauth2-proxy 127.0.0.1:4180 → /run/kb-edge/mcp.sock
      /.well-known/… (PRM, AS meta)   static files, generated from Nix
      /realms/kb/{auth,token,certs}, /realms/kb/broker/google/…,
      /realms/kb/login-actions/, /resources/  → Keycloak 127.0.0.1:8180
```

| Unit | Runs as | What it does |
|---|---|---|
| `nginx` (vhost `mcp-edge`) | nginx | The allow-list (B4). Strips cookies from `/mcp`. Adds `WWW-Authenticate: Bearer resource_metadata=…` to a 401. Takes a `/mcp` body up to kb's own limit, 35018328 bytes (kb's largest asset, 25 MiB, as base64, plus 64 KiB), and streams it on without spooling it to disk, so a request without a token costs no storage. Other routes take at most 64 KiB |
| `keycloak` + `postgresql` | dynamic `keycloak` | Realm `kb`: static clients `gemini` and `claude`, Google as the only way in. Keeps its database (sessions, refresh tokens, signing keys) across restarts, reboots and upgrades. Restarts after a crash |
| `mcp-edge-realm` | dynamic | After every Keycloak start, reconciles the realm from Nix (keycloak-config-cli, as the master realm's `mcp-edge-admin` service client, over loopback). Lives as long as one Keycloak run |
| `mcp-edge-oauth2-proxy` | `kb-edge` | Lets a request through only with a Keycloak access token whose `aud` is `https://<host>/mcp`, whose `iss` is the public issuer, and whose verified email is listed. Loopback egress only. Lives exactly as long as one Keycloak run: stops when Keycloak stops or crashes (`BindsTo=`), starts once `mcp-edge-realm` has reconciled the realm after every Keycloak start (`Upholds=`) |
| `kb-remote` | `kb-edge` | `kb --root <store> mcp --listen unix:/run/kb-edge/mcp.sock`, `KB_VIA=mcp-remote`, in an allow-list sandbox. `tini` is its PID 1 |
| `kb-remote-sandbox-check` | `kb-edge` | The same sandbox, probed from inside. `kb-remote` requires it to pass |
| `kb-remote-store-acl` | root | ACLs so `kb-edge` and the owner both read and write the store |
| `mcp-edge-secrets` (unit) | root | Generates the client secrets and the admin client's. Fails, naming the files, while the Google client is missing |

oauth2-proxy and kb-remote share the `kb-edge` user, and `ProtectProc=`
hides only *other* users' processes. So each runs in its own PID namespace
(`PrivatePIDs=`); otherwise either could open the other's mount view through
`/proc/<pid>/root`.

Two choices differ from the design:

- **Keycloak, not Dex (B3).** See below.
- **The allow-list at two layers (B4).** The design mounts paths in tailscaled. Here, one route table (`modules/stacks/mcp-edge/routes.nix`) feeds both layers:
  - **tailscaled**, outer: it mounts exactly those paths, each one with its subpaths, all pointing at the front. The tailnet and Funnel get the same mounts.
  - **the front (nginx)**, inner: it matches exact paths and answers 404 for anything else, a subpath of a mount included.

  The front does more than filter: with `mcpFunnel` off it refuses any request tailscaled marks as public (Off switch, below), it strips cookies from `/mcp`, adds the 401 header, caps and streams bodies, normalises paths, and serves the discovery documents. So every mount goes through it, never straight to oauth2-proxy or Keycloak. The front runs on loopback, so the VM test checks the allow-list against the real units.

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

Keycloak is fenced (B4): its admin console and account console are disabled
at build time (`features-disabled`). Its admin API exists, on 127.0.0.1 only,
for the realm reconcile and `revoke-all`; the only admin is the master
realm's `mcp-edge-admin` service client, whose secret is root's machine
state. It has no management port, and its cache is `local`, so no JGroups
ports. The front routes only the sign-in paths above, never `/admin` or
`/realms/master`. Keycloak's own discovery documents are
not routed: the static ones list only code + S256, client secrets, and no
registration, device, userinfo or logout endpoint.

Clients get no `offline_access` scope, so asking for it fails the sign-in
(`invalid_scope`). An offline token would outlive the 30-day session
maximum. The realm also caps offline sessions at 30 days, as a backstop.

**Restarts keep you signed in; the realm is still Nix's** (the owner's
decision). Keycloak keeps its database across restarts, reboots and
upgrades, so its sessions, refresh tokens and signing keys survive and
Gemini and Claude stay signed in, for at most 30 days a session. After every
Keycloak start, `mcp-edge-realm` reconciles the realm from Nix with
keycloak-config-cli:

- It sets the realm's settings (token lifetimes, the 30-day session and offline caps), each client (secret, exact redirects, scopes, grant toggles, the audience mapper) and the Google identity provider exactly as declared.
- keycloak-config-cli merges a client's attributes, so an override set by hand would survive it. So each client also declares, pinned to the realm's values, every attribute that would override the realm's lifetimes: `access.token.lifespan`, the client session and offline session idle and max, and `client_credentials.use_refresh_token`. It also declares an empty `authenticationFlowBindingOverrides`, so no client gets a sign-in flow of its own.
- It deletes any client or identity provider that is not declared, such as one added by hand. Keycloak's own built-in clients stay.
- It deletes any key provider Keycloak did not generate (a key imported by hand). It leaves users, sessions and the generated signing keys alone.

Until it has succeeded after this Keycloak start, nothing is served under
rules that may be stale. The front answers 503 on every Keycloak route
(sign-in, token, keys, broker, login pages) until `mcp-edge-realm` writes
`/run/mcp-edge-realm/reconciled`. systemd removes that file when the unit
stops or fails, and the unit stops with Keycloak. oauth2-proxy waits for it
too, so `/mcp` is never served for a realm that did not reconcile. Revoking every token is a command of its own (below), no
longer a side effect of a restart.

Keycloak's database is machine state that is not backed up: losing it only
signs every connector out. If the admin client's secret
(`keycloak-admin-secret`) is lost while the database is kept, the reconcile
can no longer sign in. Then drop the database:
`sudo runuser -u postgres -- dropdb --force keycloak`, then
`sudo systemctl restart mcp-edge-secrets`. Keycloak starts on an empty
database, creates the admin client with the new secret, and everyone signs
in again.

## Why the secret

Anyone can add this URL as a connector in *their own* Gemini or Claude and
send you the sign-in link. The vendors use one callback for every user, so
the redirect check cannot tell their connector from yours. Only your
connector holds the client secret, and without it the code you approved
cannot be redeemed. The VM test's phishing check is exactly this. The
approval screen ("gemini wants access") is a second, weak layer.

## One-time steps (the owner)

A step-by-step page walks through these, with a check for each step:
[mcp-edge-setup.html](mcp-edge-setup.html) (open it from a checkout; it
is one static file). This section is the canonical statement: where the
page and this section differ, this section is right.

**Decided defaults, pending the owner's confirmation:**

- The only Google account let through is `hoangng71299@gmail.com`: `my.stacks.kb.stores.kb.remoteMcp.emails` in `hosts/shared-server/default.nix`.

1. **Google OAuth client.**
   - In Google Cloud console → APIs & Services → Credentials, create an OAuth client ID of type *Web application*.
   - Give it exactly one authorized redirect URI: `https://shared-server.taild98079.ts.net/realms/kb/broker/google/endpoint`.
   - On the OAuth consent screen (newer consoles: Google Auth Platform → Audience), add your account as a test user, or publish the app. It asks only for `openid email profile`.
2. **The Google client on shared-server.** It is root-only machine state, never committed and never pasted anywhere else. From any machine:

   ```bash
   ssh -t shared-server sudo mcp-edge-secrets google
   ```

   It asks for the client ID, then the client secret, without showing the secret as you type. It trims stray spaces and warns if either value does not look like Google's (`….apps.googleusercontent.com`, `GOCSPX-…`). It writes both files, 0400 root, into `/var/lib/mcp-edge/secrets` (0700), and never prints the secret. If the edge is already running, it offers to apply the client at once, which signs nobody out. `sudo mcp-edge-secrets status` then lists the files, their modes and ages, never their values.

   <details><summary>Without the command</summary>

   ```bash
   sudo install -d -m 0700 /var/lib/mcp-edge/secrets
   sudo sh -c 'umask 077; cat > /var/lib/mcp-edge/secrets/google-client-id'      # paste, Enter, Ctrl-D
   sudo sh -c 'umask 077; cat > /var/lib/mcp-edge/secrets/google-client-secret'  # paste, Enter, Ctrl-D
   ```

   </details>

3. **Turn it on.** kb's pin has `kb mcp --listen` since 0.3.1-nightly.20261124162930 (`scripts/dev kb mcp --help` lists it).
   - Check the email list (above).
   - Set `mcpEdge = true;` in `hosts/shared-server/default.nix`, then commit and push to `main`.
   - On shared-server, pull and run `nohup rebuild > ~/rebuild.log 2>&1 &`. It runs detached, so it finishes even if the session that started it ends.

   The first start writes `client-gemini-secret`, `client-claude-secret` and `keycloak-admin-secret` into the secrets directory.
4. **Public reach: Funnel (phase 1c).**
   - Gemini's and Claude's backends call the edge from their own clouds, not from your devices. A tailnet-only URL cannot even start their sign-in, so Funnel has to be on before step 5, including the first Gemini attempt that reveals its redirect URI.
   - That is safe:
     - tailscaled mounts only the allow-list's paths, and the front answers 404 to anything else.
     - `/mcp` needs a token from an allow-listed Google account.
     - `clients.gemini.redirectUris` starts empty, so Keycloak refuses every Gemini sign-in until you pin its URI.
   - First, the tailnet policy must grant `tag:shared-server` the `funnel` node attribute. `configs/tailscale/policy.hujson` declares it (`nodeAttrs`), and the policy reaches the tailnet when it lands on `main` (the Sync Tailscale policy workflow; docs/tailscale.md). `scripts/check-tailscale-policy.sh` fails a declared Funnel without it.
   - Set `mcpFunnel = true;` in `hosts/shared-server/default.nix`, commit and push to `main`, then pull and rebuild on shared-server, as in step 3.
   - Funnel comes on only when port 443 serves exactly the allow-list's mounts. If something else already serves 443 (an `adhoc` share, which takes 443 by default, or a hand-made `tailscale serve`), the reconcile does not take the port over and nothing goes public: `journalctl -u tailscale-services` names what is mounted there. Clear it with `sudo tailscale serve --https=443 off` (`adhoc off` refuses a port the configuration declares, which 443 is once the edge is deployed); the job retries every 30 seconds and takes the port once it is free.
5. **Connect Gemini.**
   - On gemini.google.com, turn on Developer Mode, then choose "Connect to an MCP server" and paste the URL `https://shared-server.taild98079.ts.net/mcp`.
   - Under "Show more" (additional settings), enter client ID `gemini` and the client secret from `ssh -t shared-server sudo mcp-edge-secrets client gemini` (or `sudo cat /var/lib/mcp-edge/secrets/client-gemini-secret`).
   - The first attempt is refused, by design: see Gemini's redirect, below. Pin the URI, rebuild, and connect again.
6. **Connect Claude.**
   - claude.ai → Settings → Connectors → Add custom connector, with the same URL. Under Advanced settings: client ID `claude`, client secret from `sudo mcp-edge-secrets client claude` (or `sudo cat /var/lib/mcp-edge/secrets/client-claude-secret`).
   - Claude's redirect, `https://claude.ai/api/mcp/auth_callback`, is already pinned in `clients.claude.redirectUris`. If Claude is refused with "Invalid parameter: redirect_uri" anyway, take the refused URI from the same log, as for Gemini.

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
push and `rebuild`. Every redirect is exact: a `*` anywhere fails evaluation,
because Keycloak would read it as a wildcard. If Gemini's URI changes from
one connection to the next, a wildcard would be needed, and that decision
is the owner's (design §7). It would mean changing that assertion in
`modules/stacks/mcp-edge/default.nix`.

## Off switch

- **Public reach only:** `mcpFunnel = false;` in the host file, then `rebuild`. The edge stays on the tailnet.
  - The reconcile's first step, before the Tailscale Services or anything else that can fail, takes Funnel down on every port it manages that is not declared with Funnel (`tailscale serve --https=443 off`, which removes the port's mounts and their Funnel). It then sets the tailnet mounts again.
  - A port it manages that is declared with Funnel keeps it only while it serves exactly the declared mounts; one with a mount added by hand loses Funnel the same way, and gets exactly the declared mounts back.
  - Funnel on a port it does not manage (an `adhoc` share turned public by hand) gets a warning in `journalctl -u tailscale-services`, not a change: turning it off would also drop that port's tailnet mounts. `tailscale funnel status` shows it.
  - It never runs `tailscale funnel reset`, which would clear the machine's whole serve config, its Tailscale Services and adhoc shares included.
  - The front refuses (404) any request tailscaled marks as public (`Tailscale-Funnel-Request: ?1`), before proxying it. tailscaled checks Funnel only when it accepts a connection, so a public keep-alive connection opened while Funnel was on would otherwise keep reaching the mounts. tailscaled sets that header on every request of a Funnel connection and strips it from any other, so a client can neither remove it nor fake its way past: sending it only gets the sender refused.
- **Declared:** `mcpEdge = false;` in the host file, then `rebuild`. That removes the units, the `kb-edge` account's processes and the tailnet entry, and its Funnel with it. `app-kb` is untouched.
- **Immediate:** `sudo systemctl stop mcp-edge-oauth2-proxy kb-remote keycloak`, or `sudo tailscale serve --https=443 off`, which removes the mounts on port 443 and their Funnel. The next `rebuild` restores the declared state.

## The secrets command

`mcp-edge-secrets` is installed on shared-server even while the edge is
off, because step 2 comes before the switch. Run it with sudo; over ssh,
use `ssh -t` so its prompts work.

| Command | What it does |
|---|---|
| `google` | Saves the Google client (step 2) |
| `status` | Lists each secret file with its mode and age, and the edge's units. Never prints a value |
| `client gemini\|claude` | Prints that client's secret, to paste into the vendor. The one command that prints a value |
| `rotate gemini\|claude` | Gives that client a new secret (below) |
| `revoke-all [--yes]` | Signs every connector out (below) |

## Rotate a client secret

`sudo mcp-edge-secrets rotate gemini` generates a new secret and keeps it
only if the generator succeeded and it is exactly 64 hex digits. It then
writes it under a temporary name and renames it into place (0400 root), so
the file always holds one whole secret, old or new, even if the command is
killed or the generator fails. The first-start unit writes its secrets the
same way. It then reruns the realm reconcile, which sets it. Nobody else is
signed out, but the vendor's old secret stops working at its next refresh.
Then paste the new one into Gemini: `sudo mcp-edge-secrets client gemini`.

<details><summary>Without the command</summary>

```bash
sudo rm /var/lib/mcp-edge/secrets/client-gemini-secret
sudo systemctl restart mcp-edge-secrets mcp-edge-realm
sudo cat /var/lib/mcp-edge/secrets/client-gemini-secret   # paste into Gemini
```

</details>

## Revoke every token

`sudo mcp-edge-secrets revoke-all` (it asks first; `--yes` skips that). As
the admin client, over loopback, it:

1. ends every session in the realm, which kills every refresh token;
2. replaces every key provider: a generated one by a new one of the same kind, and any other (a key imported by hand) by nothing;
3. checks that no key id that signed or verified tokens before (active or passive) still does, and that the realm has an RS256 signing key again. Otherwise it fails and says which keys survived, and never reports success;
4. restarts oauth2-proxy, which cached the old keys, so an unexpired access token (5 minutes long) is refused at once, not when a token with a new key id makes it refetch them.

Every connector then signs in again. A Keycloak restart, reboot, crash or
upgrade no longer does this: they keep everyone signed in. oauth2-proxy still
lives exactly as long as one Keycloak run. It stops with Keycloak at once,
crashes included. Keycloak restarts 5 seconds after a crash, and oauth2-proxy
starts again once the realm has reconciled.

## Tests

`checks.x86_64-linux.mcp-edge` (`modules/stacks/mcp-edge/tests.nix`) is a
NixOS VM with app-kb (real kb), kb-remote, oauth2-proxy, Keycloak and the
front. Dex's password connector stands in for Google, and an nginx TLS
terminator stands in for tailscaled. It checks:

- **Tailnet only:** nothing listens beyond loopback. Keycloak's admin API answers on loopback only, and only with the admin client's token (401 without).
- **tailscaled's mounts (the vpn reconcile and the edge's real entry, against a fake `tailscale` that keeps a serve config as tailscaled does: `tests/fake-tailscale.py`):**
  - Tailnet only: exactly the 18 allow-list paths, each to `<front><path>`, with no `/` mount and no Funnel.
  - The front routes every one of them.
  - Using tailscaled's own lookup, none of about 30 paths that must never be reachable (`/`, `/admin…`, `/oauth2/*`, the master realm, the account console, and Keycloak's userinfo, logout, registration and device endpoints) falls under a mount.
  - Funnel on: the same mounts, public. A mount added by hand to that port is gone after the next run, and Funnel stays on exactly the declared mounts. The edge off: nothing of it is left, its Service stays.
  - Funnel off while every Service command fails: Funnel is down anyway, taken down before the first Service command.
  - An adhoc share already on 443: neither switch takes the port over, the share is untouched, nothing goes public, and the failure names the share and `sudo tailscale serve --https=443 off`.
  - A mount appearing on the port while the reconcile sets it: Funnel never comes on, and the port is taken down.
  - Funnel set by hand on a port the edge does not manage (8443): warned about, left as it was.
- **The front under each switch:** with `mcpFunnel = false`, a request carrying `Tailscale-Funnel-Request: ?1` is 404 on every route (the discovery document, `/mcp`, the token endpoint), while the same requests unmarked work. Switched to `mcpFunnel = true` (a specialisation of the same machine), the marked requests reach the edge; switched back, they are 404 again.
- **Phishing:** a sign-in started as `gemini` and redeemed with a wrong secret, or with none, gets no token.
- **Grants:** no PKCE, plain PKCE, a missing verifier, implicit, hybrid, password and client-credentials grants are all refused. The authorization endpoint itself refuses the implicit and hybrid ones, and the redirect's query and fragment carry no code and no token. `offline_access` is refused (`invalid_scope`). An unregistered redirect is refused and logged, and a `*` in a declared redirect fails evaluation.
- **B3:** the owner's access token has `aud` = the resource; the ID token does not. Each of these is refused at `/mcp`:
  - the ID token;
  - a client-id audience or a foreign audience;
  - a foreign key, a foreign issuer or a wrong `iss`, the last signed with Keycloak's own key (B5);
  - an expired token or an unverified email;
  - a second identity's token (403);
  - a genuine oauth2-proxy session cookie, minted with the running secret: oauth2-proxy itself accepts it, but the front never passes it on.

  A forged token that is right in every claim passes, and the owner's real tokens pass and list the tools.
- **B4:** about 40 paths outside the allow-list return 404, including `/oauth2/*`, `/ping`, the admin console, the master realm, the account console, and the userinfo, device, introspection, registration, logout and health endpoints, plus traversal spellings.
- **B1:**
  - The socket is `kb-edge kb-edge 0600` in a `0700` directory, and a process of the owner's cannot connect.
  - Writes through app-kb and through kb-remote interleave, and each side sees the other's. Every file stays read-write for both after kb's atomic replaces.
  - From inside kb-remote's namespaces, oauth2-proxy's process and its `/proc/<pid>/root` are absent, and the reverse holds too; on the host's `/proc`, kb-edge reaches both. Both units still stop promptly on SIGTERM, and afterwards the proxy still reaches kb's socket.
- **Uploads:**
  - A 25 MiB asset passes through the whole chain, and a 26 MiB one is 413 at the front, before oauth2-proxy or kb.
  - A watch on nginx's client-body temporary directory sees nothing written for an unauthenticated 33 MiB `/mcp` POST (refused) or for the authenticated 25 MiB upload. Its control, a 48 KiB POST to the token route, is seen.
  - A 1 MiB POST to a sign-in route is 413.
- **B2:** `kb-remote-sandbox-check` passes inside the unit:
  - `/` lists only the binds and the API filesystems, and `/run` holds only `kb-edge`;
  - other stores' sockets, `/run/tailscale`, `/run/dbus`, `/run/user` and `/etc` are absent, and the owner's home shows only the way down to the store;
  - TCP, UDP, netlink and a host abstract socket all fail;
  - writes outside the store and state fail.

  The same probe run outside the sandbox fails.
- **B5:**
  - oauth2-proxy has `IPAddressDeny=any` and `IPAddressAllow=localhost`.
  - A listener on the machine's LAN address is reachable from the host but refused from inside oauth2-proxy's cgroup. Keycloak on loopback still answers from inside.
  - A Keycloak restart keeps the owner signed in: oauth2-proxy restarts with it, the token from before still passes, and the connector's refresh works, signed with the same key. Then `mcp-edge-secrets revoke-all`: the same unexpired token is refused at once, its refresh token is dead, and a new sign-in gets a new key id.
  - Keycloak killed with SIGKILL: oauth2-proxy goes down with it within 2 seconds and comes back with the restarted Keycloak as a new process. The token from before still passes, and so does its refresh.
  - `systemctl stop keycloak`, then `start`: oauth2-proxy and the realm reconcile stop, then run again, and a token from before passes.
- **The realm is Nix's:** a client added by hand through the admin API, and Claude's redirect changed by hand (which then refuses Claude's real sign-in), are gone and restored after the next Keycloak start. A token from before the restart still passes.
  - A client's `access.token.lifespan` set to an hour by hand (a token then lasts 3600 s) is back to 300 s after the next start. A signing key imported by hand (which Keycloak then signs with) is gone, and its token is refused.
  - With the reconcile held after a start, every Keycloak route (`/auth`, `/token`, `/certs`, `/resources/`) is 503. The discovery documents still answer, `/admin` and `/realms/master` are 404 at the front, and the admin API on loopback is 401 without a token.
- **`revoke-all` with a key imported by hand:** Keycloak signs with that key, `revoke-all` deletes it (and says so), it is gone from the JWKS, and its token is refused.
- **`mcp-edge-secrets`:** as a non-root user it refuses. Empty input changes nothing. The Google client typed with stray spaces is saved trimmed, 0400 root in the 0700 directory, with no temporary file left, and the secret appears in neither stdout nor stderr. Both shape warnings fire for the stand-in's values. Applying it re-reconciles the realm and sign-in still works. `status` prints no value at all. `client gemini` prints exactly the file's secret on stdout. The unit's own secrets are 0400 root. `rotate claude` replaces the live file in one rename (`inotifywait` sees only `MOVED_TO` for it, never a delete or a write in place), and Claude signs in with the new secret. Killed at six points in its run, it leaves one whole 64-hex-digit secret, 0400. With a fake `openssl` bind-mounted over the real one (one that fails after printing part of a value, one that prints 63 digits, one that prints 64 non-hex characters), `rotate` refuses and leaves the old secret, and the unit fails without writing the secret it had to generate; no temporary file is left.

kb-remote and app-kb both run the pinned kb (`pkgs.kb`) on the same store,
as shared-server would.
