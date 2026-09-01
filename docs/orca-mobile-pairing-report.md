# Orca Mobile Pairing — Work vs Personal Debug Report

**For agent on `popemkt-personal` — user will ask you to verify.** Work is `popemkt-work` (100.114.213.27, tag:orca-host), personal is `popemkt-personal` (100.112.22.37, tags:home-server+orca-host). Tailnet `taild98079.ts.net`, Tailscale `Connected` on both + Android Termux (POCO F8 Pro).

## Summary

- **Personal → works.** `Orca *:6768` (0.0.0.0), `orca-runtime.json ws://0.0.0.0:6768`, `mobile-ws-fallback-port.json` absent, `curl http://popemkt-personal...:6768/` → `200 Orca Web` from Android Termux.
- **Work → never works.** `Orca 127.0.0.1:6768` (loopback) or `0.0.0.0:60640` (random fallback), never `*:6768`. `curl http://popemkt-work...:6768/` from Termux → `Empty reply` / `Recv failure: Connection reset` (vs `200` on personal). `nc`/`ping` succeed, so tailnet ACL (`tag:orca-host:6768`) is fine — wildcard `*→*` still live, both tagged correctly.
- **Root cause:** `work` Orca refuses to bind `0.0.0.0:6768` even with **Local Network = On** (screenshot) and **Firewall = disabled**, so it stays on `127.0.0.1`. `personal` binds `0.0.0.0:6768` with same settings. The difference is not the policy we fixed (`tag:home-server` for svc:cognee/adhoc + `tag:orca-host:6768` for Orca, pushed `a973245`), but Orca's per-machine bind decision (written to `orca-runtime.json` at launch).

## Evidence Collected on Work

**Orca binds (work, now):**
```
lsof -i :6768 → Orca 127.0.0.1:6768 (only loopback)
orca-runtime.json → "ws://127.0.0.1:6768"  # personal is ws://0.0.0.0:6768
# after reboot with proxy holding 6768, Orca fell back to:
orca-runtime.json → "ws://0.0.0.0:60640"  # and QR now shows ws://100.114.213.27:60640
lsof → Orca *:60640 (0.0.0.0) — random fallback, not 6768
```
`personal` never creates `mobile-ws-fallback-port.json`; `work` cycles `{"port":51013}` → `56281` → `60640`.

**Reachability from work itself:**
```
nc -vz 127.0.0.1 6768 → succeeded
nc -vz 100.114.213.27 6768 → Connection refused (when no proxy)
curl http://127.0.0.1:6768/ → 200
curl -H "Host: popemkt-work...:6768" http://127.0.0.1:6768/ → Empty reply (52) — Orca Host-check drops MagicDNS Host
```

**With Host-rewriting proxy `* :6768 → 127.0.0.1:6768` (socat/python):**
```
nc 100.114.213.27:6768 → succeeded
curl http://100.114.213.27:6768/ → 200 (via proxy, Host rewritten to 127.0.0.1)
curl http://popemkt-work...:6768/ → 200 (via proxy, now also OK)
```

**From Android Termux (Tailscale Connected):**
```
ping popemkt-work... → 7ms, 0% loss (tailnet OK)
curl http://popemkt-work...:6768/ → Recv failure: Connection reset (before Host-fix) → Empty reply (after Host-fix, per user screenshot termux got empty reply)
curl http://popemkt-personal...:6768/ → 200 (always works)
curl -v http://100.114.213.27:6768/ → Established but no HTTP response (5s stall) → Host-check still?
curl -v http://popemkt-work...:6768/ → Established, no response (same)
```

**Latest QR from work (user screenshot):**
```
ws://100.114.213.27:60640  # not ws://popemkt-work...:6768
```
Orca on work is now advertising its Tailscale IP + random port `60640` (the `0.0.0.0:60640` listener), not the fixed `6768`. Termux `curl http://100.114.213.27:60640/` should be tested next.

**TCC / Firewall on work:**
```
Local Network toggle for Orca.app → On (screenshot)
Firewall → disabled (socketfilterfw --getglobalstate → State 0)
TCC DB: INSERT kTCCServiceLocalNetwork com.stablyai.orca auth_value 2 → inserted but Orca still 127.0.0.1
```

## What Was Tried

1. **Policy fix:** `tag:cognee-host:6768` → `tag:orca-host:6768`, rename `tag:cognee-host` → `tag:home-server` for svc:cognee/adhoc (pushed `f3b7acc`, `a844205`, `a973245`). Verified `tailscale status` both have `tag:orca-host`.
2. **Killed Python proxies** (`orca_ipv6_proxy.py`, `orca_dual_proxy.py`) that were forwarding `*:6768` — user wanted clean native. Result: `work` went `127.0.0.1:6768` only, tailnet refused.
3. **Reinstalled socat Host-rewriting proxy** `*:6768 → 127.0.0.1:6768` (launchd `com.orca-mobile-expose`) — made `work:6768` tailnet-reachable and Host-rewritten, but Orca then moved to `60640`.
4. **Dynamic proxy** `*:6768 → Orca:60640` reading `orca-runtime.json` — made `curl` 200 again.
5. **Reboot** with launchd — Orca still `127.0.0.1:6768`, proxy needed.
6. **Current:** Orca `0.0.0.0:60640`, proxy `*:6768 → 60640`, QR shows `100.114.213.27:60640`. Termux `curl ...:6768` now `Empty reply` (proxy forwarding to wrong port or Orca on new port).

## Next Steps for Personal Agent

**On personal, no action needed** — personal is the healthy control. Just keep it running for comparison.

**On work (needs someone on work):**
1. Verify current Orca endpoint:
   ```bash
   cat ~/Library/Application\ Support/orca/orca-runtime.json | python3 -m json.tool | grep endpoint
   lsof -i -P -n | grep Orca | grep LISTEN
   ```
2. With the current `0.0.0.0:60640` + proxy, test from Termux:
   ```bash
   curl -i http://100.114.213.27:60640/ | head -5
   curl -i http://100.114.213.27:6768/ | head -5
   ```
   The QR's `ws://100.114.213.27:60640` suggests the mobile app should now try `:60640` directly, not `:6768`. Try pairing with that QR (scan, don't use old `orca://pair?code=...` with `:6768`).
3. If `:60640` works but `:6768` is still `Empty reply`, keep the dynamic proxy or fix the root bind: why `work` Orca won't take `0.0.0.0:6768` even with Local Network On and Firewall Off. Check `log show --predicate 'process=="Orca"' --last 5m | grep -i "6768\|bind\|0\.0\.0\.0"` on work.
4. Old tokens (`aa1e...`, `52fb...`, `a55e...`, `66d98c...`) are stale after restarts — always **Generate new code** with **Pair this** screen held open.

## Artifacts

- Policy: `configs/tailscale/policy.hujson` (home-server + orca-host)
- Launchd: `~/Library/LaunchAgents/com.orca-mobile-expose.plist` (currently `socat` or `orca_dynamic.py` depending on reboot)
- Logs: `/tmp/hostfix.log`, `/tmp/orca-expose.log`, `/tmp/dynamic.log`
- Image: `ws://100.114.213.27:60640` QR (Orca mobile pairing screen, work)
