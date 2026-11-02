# Moving popemkt's bb server from shared-server to popemkt-personal

Status: plan only, nothing moved. Researched 2026-11-02 from shared-server
(bb 0.48.1), this repo at `515714e07`, and bb's own server-move code.

## Short answer

Move only the server, and not yet. bb's `bb server move` copies just the
server's data: the database, settings, plugin data and attachments. Worktrees,
thread storage and checkouts stay on the machines that own them. shared-server
would stay a bb machine and keep running the heavy agent work. That split is
the right end state.

Five things block a move today, though. bb's mover does not know this repo's
two-unit systemd shape, so the repo has to change in the same step as the
move. The Mac has no declared way to run a bb server (`my.services` is
NixOS-only). The Mac reaches shared-server only through a DERP relay. Version
pinning would flip to the wrong side. FileVault plus launchd agents mean the
server stays down after any Mac power loss until someone logs in at the Mac.
Clear those first (see [Blockers](#blockers)), then move.

If shared-server's hardware resets have actually stopped (the last one before
the current boot was 2026-10-30), the case for moving is weaker than it looks.
A reset still kills every thread that runs on shared-server: 52 of the 77
threads, and all 4 that are active now. Moving the server only keeps the UI,
history, and the Mac-hosted threads alive through a reset.

## What bb's mover does

From `bb guide machines` and `bb server move --help`:

- `bb server move --to <machine> [--address <url>] [--check]`. It is
  experimental, and gated behind the `serverMove` experiment, which is **off**
  on this server.
- It copies the server data to the target's machine data dir and switches
  every machine and app to the new server. The old computer keeps running as a
  regular machine and refuses to start the old server again (it is locked).
- With bb connect (here: disabled, and the server is not signed in to
  getbb.app), URLs stay the same. In a direct-address setup like this one it
  needs `--address`: the URL every machine and app will use afterwards.
- On the target, bb rewrites the machine's **own service definition** (the
  launchd plist the manual enrollment installed) to run `bb-app start` as a
  server with that data dir. It refuses if no service definition is found
  while the machine "runs under" some other supervisor (daemon
  `planActivation`).
- Failure before the switch leaves the server where it was. If the target never
  confirms the takeover, the move waits in `recovery_required` (the old server
  stays up but read-only) and `bb server move cancel` abandons it.
  `bb server unlock` revives the old copy but loses everything written since
  the move.

### The checklist: `--check` could not run

`bb server move --to popemkt-personal --check` (and `--json`) were refused:

```
Moving the server is off. Turn on the "Server move" experiment in Settings →
Experiments, or run bb settings experiment serverMove true, then try again.
```

I did not turn the experiment on, because the brief allowed only the read-only
check. Instead I read the check from bb 0.48.1's own code
(`server/dist/start-server.js` `runServerMoveCheck`, and the target daemon's
`server_move.inspect`). Below is each item with what it should report here.
Turning the experiment on and rerunning `--check` is step 1 of the plan, and
it settles every "unknown".

| Check id | Severity | Expected here |
|---|---|---|
| `server-url-required` | blocker | **Hits.** Direct mode (connect off), so `--address` is required |
| `target-offline` / `target-not-active` | blocker | Clear: popemkt-personal (`host_v56deucqgh`) is connected, manual, active |
| `unsupported-platform` | blocker | Clear: macOS is supported |
| `target-has-server-data` | blocker | **Unknown.** Hits if the Mac's machine dir already holds a `bb.db` |
| `existing-target-server-data` | warning | **Likely.** The desktop app's own `~/.bb` on the Mac. It is archived only with `--archive-existing-data`, and only if that bb has been quit ("Quit bb there first") |
| `port-unavailable` | blocker | **Unknown.** Hits if the bb desktop app or anything else holds the server port (38886) on the Mac |
| `target-version` / `target-newer-version` / `server-entry-unavailable` | blocker | **Unknown.** The Mac's machine install must have the bb server entry and match 0.48.1 |
| `target-disk-space(-tight)` | blocker/warn | Probably clear: about 0.4 GB of DB plus 15 MB of attachments plus plugin data |
| `source-disk-space` | blocker | Clear: 736 GB free on shared-server |
| `path-plugins-missing` | warning | **Hits.** All 9 repo plugins (8 from the bb stack plus `sandbox`) run from `/home/popemkt/.local/state/dotfiles/bb-plugins/...`, which does not exist on the Mac |
| `env-paths-missing` | warning | Probably clear: `~/.bb/env.json` holds only `env` |
| `gh-login` / `codex-login` | warning | **Unknown.** Helper inference and voice use the *server machine's* Codex login |
| `timezone` | warning | Both are `Asia/Ho_Chi_Minh` while the Mac is home. Schedules follow the server's zone, so they shift if a travelling Mac changes zone |
| `running-turns` | warning | **Hits** whenever work is running (4 active at check time); all are stopped |
| `plugin-schedules` | warning | Plugin schedules (e.g. agentation-mentions prune) pause. There are no bb automations (0 in all 7 projects) |
| `offline-machines` | warning | Clear now: all 3 machines are connected |
| `unencrypted-transfer` | warning | Clear if `--address` is https (Tailscale Serve) |
| `app-url-*` / `external-url-*` | info/warn | **Silent, and that is the catch.** bb rewrites `BB_APP_URL`/`BB_EXTERNAL_URL` only in the files it manages. Ours are set in the systemd units (`hosts/shared-server/default.nix` `bbHome`), so bb neither sees nor rewrites them |
| `managed-config-replaced` | info | The server's skill settings and config replace the Mac's matching ones |

## Inventory: what on shared-server depends on popemkt's bb being there

| Thing | Where | Effect of a server move |
|---|---|---|
| `app-bb` (server, `bb-server --server-port 38886`) | `my.services.bb`, `bbHome` | Must be **removed** in the same change. After the move the old copy refuses to start, and systemd would restart-loop it |
| `app-bb-daemon` (`bb-host-daemon --server-url http://127.0.0.1:38886`) | same | Must **stay**, pointed at the new server's URL. The URL is a hard-coded flag, so bb's re-pointing cannot win against it |
| `app-bb-restart-when-idle` and `idleCheck` | `bbHome`, `modules/nixos/system/app-restart` | The check runs `bb thread list` against the default `127.0.0.1:38886`. After the move nothing answers there, so it counts as busy forever and upgrades never apply. It needs `BB_SERVER_URL` set to the new server. GAP `01M5P0D3VP9RXH16D7VJV282BT` (daemon can't reach server ⇒ never idle) gets more likely when the server is a relay hop away |
| Version pin (`app-npm-pin`, `update-npm-globals`) | `modules/stacks/bb/nixos.nix` | Today Nix pins the server and the daemons follow. After the move the server is bb's self-updating launcher on the Mac, while shared-server's daemon is Nix-pinned **without `--auto-update`**. One Mac self-update that bumps the protocol leaves all shared-server threads disconnected ("protocol mismatch, retrying") |
| `svc:bb-popemkt` → `127.0.0.1:38886` | `vpn` services + `configs/tailscale/policy.hujson` (auto-approver: `tag:shared-server` only) | It can't simply follow the server; see [Address](#address). Any new Service needs a grant and an `autoApprovers.services` entry for `tag:home-server`. Policy is applied by CI through the GitHub OIDC trust credential (`docs/tailscale.md`) |
| kb ↔ bb framing | `bbFramesKb "popemkt"` on `my.services.kb` (`--embed-origin`, `--embed-script …/bbim/http/bridge.js`) | Both point at bb-popemkt's origin. A new bb origin needs kb-popemkt restarted with the new one, or the kb tab won't frame and bbim hints die |
| kb plugin `KB_URL` / `KB_SOCKET` | bb server env in `bbHome` | `KB_SOCKET=/run/kb-popemkt/kb.sock` is an owner-only Unix socket **on shared-server**, which a Mac server can't reach. The agent tools (`kb_call`, …) break until it points at a kb the Mac reaches. That kb is either the Mac's own home kb (`_brain`, a **different store**) or kb-popemkt over HTTPS (the socket gave owner-only trust; HTTPS needs the tailnet grant) |
| `sandbox` plugin | `modules/stacks/sandboxes` (NixOS-only: bwrap, `/etc/bb-sandbox/policy.json`, `sandbox.slice`) | It runs in the **server** process and uses the server machine's bwrap. On the Mac, `bb sandbox` and the sandbox agent tools lose their local provider. Remote placement is not something the plugin has today |
| bb plugins via `bb-plugins-sync` | `modules/common/home-manager/bb-plugins` | It installs only into a server whose data dir is under the account's home. On shared-server it then finds none and warns, which is harmless. On the Mac, a rebuild reinstalls them from Mac paths, and that fixes `path-plugins-missing` |
| Account pooler | built-in `account-pool` plugin, in server plugin data | The plugin data (accounts, OAuth tokens) moves with the server. Machines reach pool endpoints through server access, so after the move every pooled request from shared-server threads goes across the relay hop to the Mac |
| Thread worktrees, thread storage | `~/.bb/plugins/environment-git-worktree/host-data` (17 worktrees), `~/.bb/thread-storage` (3.1 GB) | Stay put. They belong to the shared-server machine. The 52 shared-server threads keep working as long as that daemon is connected |
| Trial units and ports `:10000–:10009`, `adhoc-popemkt` | `trial-*` systemd-run units, node-level `tailscale serve` | Unaffected while they are made by threads running on shared-server. A thread on the Mac would use the Mac's `svc:adhoc` (`:9001`) instead |
| bytetum's bb (`app-bb-bytetum`, `svc:bb-bytetum`, `kb-bytetum`, Marginalia) | `my.services.bb-bytetum` | A separate server with its own data, so it **does not move** and is untouched. Their env pins `BB_SERVER_URL` to 38896, so freeing 38886 does not affect them |
| CLIProxyAPI, Cognee, Hermes (ai-agents) | `modules/stacks/ai-agents` (darwin-only) | They already live on the Macs, so they are unaffected |
| T3 Code, `t3-work-relay`, axioms | shared-server | Not bb, so they are unaffected |
| Secrets (`~/.config/secrets`) | machine state | They stay with shared-server, which is fine for threads running there. Anything the **server** process itself reads from there needs a copy on the Mac. Nothing found that does, but `--check`'s `env-paths-missing` is the gate |
| Mobile and push devices, browser bookmarks, the Macs' desktop apps | getbb/mobile pairing, `https://bb-popemkt…` | All follow `--address`. A pairing or bookmark on the old URL breaks if the URL changes |
| Backups | `docs/backup-strategy.md` | The server DB (384 MB plus WAL) becomes Mac state, and Time Machine would catch a live SQLite copy. It needs the same stopped/`.backup` treatment Cognee documents |

## Assessing popemkt-personal as a server

What the repo says: `hosts/popemkt-personal` is already "the tailnet's stateful
service host". It has `power.sleep.computer = "never"` and
`restartAfterPowerFailure = true`, and it publishes `svc:kb`, `svc:adhoc` and
`svc:cognee` (tag `tag:home-server`). Its workspace lives on an external
`/Volumes/Data` (TCC-gated). The repo does not record whether it is a laptop
or a desktop.

Against that:

- **Login-gated restart.** Everything that would run bb is a per-user launchd
  agent, both bb's enrollment plist and a future repo one. After a reboot
  nothing starts until popemkt logs in, and with FileVault on, an unattended
  power loss stops at the disk-unlock screen. `docs/cognee.md` already
  accepts this for Cognee. For bb it means the whole IDE is down, including
  the shared-server threads' UI and event stream, until someone is at the
  keyboard.
- **Network.** `tailscale ping popemkt-personal` from shared-server gets
  `via DERP(sin) in 72ms; direct connection not established`. popemkt-work is
  relayed too. Today the server and its busiest machine (shared-server, with
  52 threads) talk over loopback. After the move every thread event, terminal
  byte, pooled model request and plugin call between them goes
  Vietnam → Singapore relay → Vietnam. It works, but it is the opposite of
  what you want for the hottest link.
- **Travel.** If it is a laptop that travels, the server goes with it: lid,
  bag, hotel Wi-Fi, a changed timezone (schedules shift), and no recovery path
  while away. shared-server stays home with a console.
- **Service manager.** `my.services` is NixOS-only and asserts empty on darwin
  (GAP `01M5791R8EWJ0NB0Z3ENAFVMEH`). The same goes for `rebuild`'s
  idle-gated restarts, `app-npm-pin`, and the companion-unit rule. On the Mac,
  bb's own launchd plist would run the server. bb writes and auto-updates that
  plist; the repo neither declares nor pins it. That's acceptable only if
  recorded as a gap.
- **Load.** The server itself is light: Node plus a 384 MB SQLite. The heavy
  work (agents, builds, sandboxes, Chromium) stays on shared-server
  (16 threads, 30 GB, 736 GB free) as long as threads keep targeting it. The
  Mac's specs are not in the repo, but they do not matter much for a
  server-only move.
- **Reliability: the real argument for moving.** shared-server (a G14) had
  data-fabric sync-flood resets from 2026-10-21 to 10-30, 12 boots in that
  window, with RAM suspected and memtest not yet run. The current boot has been
  up 3 days. A Mac is likely the more reliable box.

## Blockers

1. **The `serverMove` experiment is off.** So `--check` has never been run.
   Unknown blockers remain on the Mac side (`port-unavailable`,
   `target-has-server-data`, `target-version`).
2. **The two-unit shape is invisible to bb.** bb expects the bb-app launcher or
   the desktop app on the source. Here the server and daemon are separate
   Nix-owned systemd units with a hard-coded `--server-url` and env-set URLs.
   `app-bb` must be dropped and `app-bb-daemon` re-pointed **in the same
   window** as the move, by a repo change applied with `rebuild`. bb's own
   `install-machine-service` must not be used on shared-server: it would
   duplicate the daemon. This path has never been tried; bb calls the
   feature experimental.
3. **The Mac has no declared server.** Before moving, the repo needs at least:
   a `my.stacks.vpn.services.bb` entry on popemkt-personal with its policy
   grant and auto-approver; `my.stacks.bb.env.popemkt` there (the Mac's
   managed env, which bb does read) carrying `BB_APP_URL`, `BB_EXTERNAL_URL`,
   `KB_URL` and `KB_SOCKET` (or a `KB_URL`-only kb mode); and a gap node for
   "bb server on darwin runs under bb's own plist".
4. **Version coupling.** The server and every daemon must speak one protocol.
   Pick one owner. The default below keeps Nix as the owner by turning off the
   Mac server's in-app updates and making shared-server's daemon follow;
   anything else breaks shared-server threads at the next bb release.
5. **No direct path between server and main machine.** Fix UDP and NAT so that
   `tailscale ping` from shared-server to popemkt-personal reports `direct`
   before the move, or accept relay latency on every thread.

## Risks (after the blockers are cleared)

- Mac reboot or power loss with FileVault means a bb outage until a local
  login. Mitigations: leave FileVault (or not) as decided under open question
  Q2, add a UPS, or accept the outage.
- An experimental mover could stall in `recovery_required` mid-move. The old
  server stays read-only and `bb server move cancel` gets back.
- `kb_call` and friends switch to a different kb, or stop working.
- `bb sandbox` loses its bwrap provider.
- Pooled API traffic from shared-server now takes the relay hop.
- Backups: the server DB becomes Mac state that needs a consistent snapshot.
- Mobile and push pairings and bookmarks break if the URL changes.
- `bb server unlock` as rollback loses everything since the move. Prefer
  moving back.

## Recommendation

**Move partially, later**: the bb server goes to popemkt-personal, and
shared-server stays a bb machine where new threads keep running by default.
Do it only after:

1. memtest has been run on shared-server. If its RAM is bad, fixing it may
   remove the reason to move at all, and if it is not fixed, the 52 threads
   that run there die on every reset no matter where the server lives.
2. Blockers 1–5 above are cleared in a repo PR (the "pre-move" PR in step 3).

Don't move the heavy work machine. Don't move bytetum's bb.

## Address

Use a **new** Tailscale Service for the Mac, `svc:bb` (`https://bb.<tailnet>`,
matching the Mac's existing `svc:kb`/`svc:adhoc`/`svc:cognee` naming), not
`svc:bb-popemkt`. During the move the old server stays up on the old address
while bb probes the new one; both answering on one name would make the probe
see the old server ("answered, but it is not the new bb server"). A Service
with two hosts would also load-balance between the two servers. Once
everything is settled, `svc:bb-popemkt` is deleted from the policy and the
admin console (a manual step, as in `docs/tailscale.md`).

## Plan

Each step is reversible until step 6.

0. **Decide.** Answer [Open questions](#open-questions). Run memtest on
   shared-server.
1. **Get bb's own checklist.** `bb settings experiment serverMove true`, then
   `bb server move --to popemkt-personal --address https://bb.<tailnet> --check --json`.
   This is read-only apart from the experiment flag. Record the blockers in
   this doc.
2. **Prepare the Mac by hand.**
   - Quit the bb desktop app's local server if it has data, or plan
     `--archive-existing-data`.
   - Free port 38886.
   - Make sure the machine install is bb 0.48.1, then run `gh auth status`
     and sign in to Codex.
   - Check FileVault and the auto-login decision (Q2).
   - Get `tailscale ping` between the two hosts to say `direct`.
3. **Pre-move repo PR**, merged and rebuilt on popemkt-personal only. Nothing
   changes on shared-server yet.
   - popemkt-personal: `vpn.services.bb.target = "http://127.0.0.1:38886"`.
   - popemkt-personal: `my.stacks.bb.env.popemkt` with `BB_APP_URL`,
     `BB_EXTERNAL_URL`, `KB_URL` (and kb socket or URL mode, Q4).
   - `policy.hujson`: grant `svc:bb` to `autogroup:member`, as today's
     `svc:bb-popemkt` grant does, plus
     `autoApprovers.services."svc:bb" = ["tag:home-server"]`. Tagged
     machines (shared-server, popemkt-work) reach it today only through the
     catch-all `* → *` grant. Name `tag:shared-server` and `tag:orca-host`
     explicitly so that narrowing that grant later doesn't cut the bb
     machines off.
   - A gap node for "bb server on darwin runs under bb's plist, unpinned".
   - The Service will show as unhealthy until the move; that is expected.
4. **Rerun `--check`** until the only blocker left is `running-turns`.
5. **Write the cutover PR now; merge it in step 6.** shared-server:
   - Replace `my.services.bb` with a machine-only entry: the daemon with
     `--server-url https://bb.<tailnet>`, `BB_APP_URL` set to the new origin,
     and an `idleCheck` with `BB_SERVER_URL` set.
   - Point `my.stacks.bb.env.popemkt.BB_SERVER_URL` at the new origin, so
     `bb` on shared-server reaches it.
   - Move `bbFramesKb "popemkt"` to the new origin.
   - Drop `svc:bb-popemkt` from the vpn services (its policy entry stays until
     step 9).
   - Decide (Q3) whether the daemon gets `--auto-update` or the Mac server
     gets `--no-in-app-updates`.
6. **Cutover.** Pick a quiet window: no active turns on any machine, and the
   idle check passes.
   1. `bb server move --to popemkt-personal --address https://bb.<tailnet>`.
      Confirm interactively and never pass `--yes` on the owner's behalf.
   2. As soon as it reports moved, merge the cutover PR on shared-server and
      run `nohup rebuild >~/rebuild.log 2>&1 &`. With app-bb gone and the
      daemon re-pointed, `restart pending until idle` is fine: nothing is
      running.
   3. If the rebuild prints `app-bb-daemon: restart pending until idle`
      (its idle check cannot reach the new server yet), force it with
      `sudo systemctl restart app-bb-daemon`.
7. **Verify.**
   - `bb machine list` shows popemkt-personal as `server` and shared-server
     connected.
   - A new thread on shared-server runs a turn, and the kb tab and `kb_call`
     work.
   - `bb pool status` looks right.
   - `bb-plugins-sync` on the Mac reinstalls the repo plugins (`rebuild`).
   - `bb plugin list` has no path errors.
   - Mobile push works.
   - bytetum's bb is unaffected (`svc:bb-bytetum`).
8. **Soak for 2 weeks.** Keep the old copy on shared-server (no
   `delete-old-copy`). Set up the Mac's DB backup.
9. **Clean up.**
   - `bb server delete-old-copy` on shared-server.
   - Remove `svc:bb-popemkt` from the policy and delete the Service in the
     admin console.
   - Update `docs/tailscale.md`, `docs/backup-strategy.md`, and the comments
     in `hosts/shared-server/default.nix`.
   - Close or retarget the gaps.

### Rollback

- **Before step 6:** revert the repo PR(s), and turn the experiment off.
  Nothing moved.
- **During the move, before the switch:** `bb server move cancel`. The server
  stays on shared-server.
- **Stuck in `recovery_required`:** `bb server move status` names the exits.
  `bb server move cancel` keeps the old server. Leave the cutover PR unmerged.
- **After the move (preferred):** `bb server move --to shared-server
  --address https://bb-popemkt.<tailnet>`. That needs app-bb's units restored
  first, so revert the cutover PR and rebuild, keeping the Mac Service
  until it is done.
- **Last resort:** stop the Mac server, run `bb server unlock --force` on
  shared-server, revert the cutover PR, and rebuild. Everything since the
  move is lost.

## Open questions

Each has the default this plan assumes.

| # | Question | Default |
|---|---|---|
| Q1 | Is popemkt-personal a desktop that stays home and plugged in, or a laptop that travels? | Desktop, always home. If it travels, **don't move**: the server would leave with it |
| Q2 | FileVault and auto-login on the Mac: accept a bb outage after power loss until a local login? | Accept it, and add a UPS. Do not turn off FileVault |
| Q3 | Who owns the bb version after the move? | Nix. The Mac server runs with in-app updates off, upgraded deliberately, and shared-server's daemon gets `--auto-update` so it follows |
| Q4 | Which kb should bb's kb tab and `kb_call` use? | The shared-server home kb (`kb-popemkt`) over HTTPS, so nothing changes for agents. The Mac `_brain` kb stays separate |
| Q5 | The new address? | `svc:bb` at `https://bb.<tailnet>`. Delete `svc:bb-popemkt` after the soak |
| Q6 | `bb sandbox` after the move? | Accept losing it until the sandbox plugin can place work on a machine. Threads on shared-server can still run bwrap directly |
| Q7 | Where do new threads run by default? | shared-server, as today. The Mac is server-only |
| Q8 | Do the move at all if memtest finds bad RAM and it gets replaced? | No. Re-evaluate after 2 weeks without a reset |
