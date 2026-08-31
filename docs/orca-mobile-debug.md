# Orca Mobile Debug — Handoff for `popemkt-personal`

**Context for agent on `personal`:** User is on `popemkt-work` trying to pair Android Termux (Tailscale) → Orca on `work` via `ws://popemkt-work.taild98079.ts.net:6768`. Pairing to `personal` works, to `work` never works — even `http://popemkt-work.taild98079.ts.net:6768/` is empty on `work` itself.

**Current tailnet policy (pushed):**
- `tag:home-server` → approves `svc:cognee` + `svc:adhoc` (personal only)
- `tag:orca-host` → `tcp:6768` for Orca Mobile (both `work` + `personal` have it — verified via `tailscale status --json`)
- Wildcard `* → *` still live, so not a firewall issue.

**Current `work` state (just cleaned):**
- Killed all Python/socat proxies that were forwarding `*:6768 → 127.0.0.1:6768` (or `→ 56281`).
- `work` Orca now: `Orca 78149 127.0.0.1:6768 (LISTEN)` + `127.0.0.1:56702` — **loopback only**, NOT `*:6768`.
- `nc -vz 100.114.213.27 6768` → `Connection refused` (tailnet IP unreachable).
- `curl http://100.114.213.27:6768/` → fails, `curl http://127.0.0.1:6768/` → `200 Orca Web`.
- `personal` is believed to be `*:6768` natively (never needed proxy) — **confirm below**.

**Why proxy was needed on `work`:** `work` Orca binds only to `127.0.0.1`, so direct tailnet `100.114.213.27:6768` is closed. `personal` binds to `*:6768`, so direct tailnet works. The proxy (`socat *:6768 → 127.0.0.1:6768`) was the band-aid. User asked to kill it for clean native — now `work` is unreachable via tailnet, which proves the bind difference.

**Tests to run on `personal` (paste full output back):**

```bash
# 1. How does personal Orca listen? (compare to work's 127.0.0.1:6768)
lsof -i :6768 -P -n -sTCP:LISTEN
lsof -i -P -n | grep -E "6768|51013|56281|56702" | grep LISTEN
cat ~/Library/Application\ Support/orca/mobile-ws-fallback-port.json 2>&1
cat ~/Library/Application\ Support/orca/orca-devices.json 2>&1 | python3 -m json.tool | head -30

# 2. Is personal tailnet-reachable from itself?
tailscale status --json | jq -r '[.Peer[] , .Self] | map(select(.HostName | startswith("popemkt-")) | {host: .HostName, tags: .Tags, addr: .TailscaleIPs[0]})'
dig popemkt-personal.taild98079.ts.net 2>&1 | grep -E "ANSWER|IN.A"
nc -vz 127.0.0.1 6768 2>&1
nc -vz 100.112.22.37 6768 2>&1
nc -vz popemkt-personal.taild98079.ts.net 6768 2>&1
curl -s -i http://127.0.0.1:6768/ 2>&1 | head -5
curl -s -i http://100.112.22.37:6768/ 2>&1 | head -5
curl -s -i http://popemkt-personal.taild98079.ts.net:6768/ 2>&1 | head -5

# 3. Orca Mobile settings on personal (check UI if possible)
# Orca → Settings → Orca Mobile → is "Local Network" / "Allow network access" enabled?
# System Settings → Network → Firewall → is Orca allowed?

# 4. For comparison, re-check work if you have access:
# ssh popemkt-work.taild98079.ts.net "lsof -i :6768 -P -n -sTCP:LISTEN; cat ~/Library/Application\ Support/orca/mobile-ws-fallback-port.json"
```

**Expected comparison:**
- `personal`: `Orca *:6768 (LISTEN)` → all `nc`/`curl` via `100.112.22.37` and MagicDNS succeed.
- `work` (current clean): `Orca 127.0.0.1:6768` → only `127.0.0.1` succeeds, tailnet IP fails.

**Next step after tests:** If `personal` is indeed `*:6768`, then `work` needs to be made to bind to `*:6768` natively (check Firewall / Orca Mobile network toggle). If that can't be fixed quickly, reinstall the `socat *:6768 → 127.0.0.1:6768` launchd as permanent workaround (we had it working: `socat TCP-LISTEN:6768,reuseaddr,fork TCP:127.0.0.1:6768`).

**Recent tokens (for reference, all single-use, now stale):**
- `work` last tried: `aa1e6ef2...` / `66d98c6b...` with endpoint `ws://popemkt-work.taild98079.ts.net:6768` → `websocket closed`.
- After fixing reachability, generate fresh `orca://pair?code=...` on `work` with **Pair this** screen held open.
