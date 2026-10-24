# bb restarts on shared-server: why threads die, and how to stop it

Investigation only. Nothing was restarted, killed, rebuilt or changed. Commands used: ps, systemctl show/cat, journalctl, reads of the installed bb-app 0.46.1 package, `bb machine list`, `bb thread list`, `bb guide`. Package files below are under `/home/popemkt/.local/lib/node_modules/bb-app/`. Line numbers refer to a local copy of `server/dist/start-server.js` (ss), `dist/bb-app.js` (launcher) and `host-daemon/dist/daemon-bundle.mjs` (minified, so quoted by content).

## 0. Findings

1. A server restart alone does not interrupt threads. The host daemon keeps running agents and reconnects. Threads die because the unit's stop kills the whole cgroup, daemon and agents included.
2. The launcher already restarts a crashed server on its own, leaving the daemon alone (`bb-app.js:20462`). A server-only restart is therefore a path bb itself supports.
3. The 10-minute outage on 2026-10-24 was a failed switch, not a slow one. `nixos-rebuild-switch-to-configuration.service` stopped app-bb at 00:36:16 and then exited with status 101. Nothing started it again until a manual sudo at 00:46:56. A clean switch (00:49:13 to 00:49:19) took 6 s, but still interrupted every thread.
4. bb upgrades cannot avoid a daemon restart. The server requires an exact protocol match with the daemon: 237 in 0.46.1, 251 in the Mac's bundled 0.47.0. Upgrades must be gated on "no active threads". Reconfiguration can be fully non-interrupting.

## 1. Process model (live ps and systemd-cgls, 2026-10-24 09:50)

```
app-bb.service  (/system.slice/app-bb.service, KillMode=control-group, Delegate=no, TimeoutStop=90s)
 bash app-bb-start (814032, MainPID)
  node bb-app --server-port 38886 --host-daemon-port 38887 --no-in-app-updates   (814034, "launcher")
   ├─ node server/dist/index.js                      (814120)  = SERVER
   │   └─ toolchain plugin process                   (814174)
   └─ node host-daemon/dist/daemon-bundle.mjs        (814167)  = BUILT-IN HOST DAEMON
       ├─ bb-parcel-watcher-child.mjs                (814295)
       ├─ bb-plugin-host-worker.mjs x N              (provider-codex, bb-sidebar, provider-acp)
       └─ bb-provider-bridge-worker.mjs (provider-claude-code) (897544, own pgid/session)
            └─ /home/popemkt/.local/bin/claude ...   (897577)  = AGENT
```

- Agents are descendants of the host daemon, not of the server. They are `setsid`'d (own pgid) but stay in the same cgroup. All of it is in one unit, so `KillMode=control-group` kills them with the server.
- `systemd-cgls -u app-bb.service` lists all of these PIDs in the one cgroup.
- The unit is the `updatedBy.npmGlobal` kind (`command = "bb-app ..."`, `modules/nixos/system/services.nix:180-188`). The script does not `exec`, so bash stays as MainPID with node as its child.
- Server and daemon talk over a WebSocket on loopback. `/home/popemkt/.bb/bb-app-runtime.json` records the launcher pid.

## 2. Can a thread survive a server restart?

Yes, if the daemon process lives on. Evidence:

- **No interruption on disconnect.** `handleDaemonSocketClosed` and `handleDaemonSessionLost` (ss ~83548-83625) only close the session row and the terminal bridge. They then schedule a "host-disconnected" UI notification after `HOST_RECONNECT_GRACE_MS` = `LEASE_TIMEOUT_MS` = 30 s (ss:69558-69566). They never call `interruptActiveThreads`.
- **Reconcile on reconnect.** `handleHostSessionOpened` (ss:83508-83548) compares `previousSession.instanceId === openedSession.instanceId`.
  - Same instance (daemon process unchanged): `reconcileDaemonReportedThreads` (ss:88958). Threads the daemon reports as active stay active. Only threads the DB thinks are active but the daemon does not report are interrupted, with cause `host-connection-lost` (ss:89043).
  - Different instance (daemon restarted): every active thread on that host is interrupted with `host-daemon-restarted` (ss:83534). This is the "host daemon disconnected" message seen on 10-24 (ss:87755).
- **No startup interruption.** The only place that interrupts on lost work outside reconcile is `settleLostHostWork`, used for imported server snapshots (ss:83626-83650). There is no "interrupt everything at boot" path.
- **The daemon buffers and retries.** It queues events in memory and posts with exponential backoff capped at 30 s. The queue has no size limit that I could find (`moe=1e3, k4e=3e4` in the delivery code). It sends `undeliveredEventThreadIds` and `activeThreads` in `/session/open`. The websocket reconnects forever with a 1 s to 10 s delay (`Mse=1e3, Lse=1e4, maxRetries: Infinity`). The queue is lost if the daemon dies.
- **Real-world proof.** popemkt-work runs a standalone daemon, and it went through the whole 10-min outage. Its log (`~/.bb-machines/bb-popemkt.taild98079.ts.net/logs/host-daemon.4.log`) shows a disconnect at 00:36:16 and retries every ~10 s. At 00:39:27 it warned "Daemon event queue is backing up" with queueDepth 11 and queueAgeMs 36755, so a turn was running. It reconnected at 00:47:06 with the same process. I could not confirm whether the Mac thread then finished cleanly.
- **Server SIGTERM is graceful** (ss:228141 and `runShutdown`). It stops sweeps, plugins and websockets, and does not tell the daemon to stop.
- **Limits.**
  - The server gets a 502 from the Tailscale proxy while it is down, so the UI is unavailable.
  - Agents calling `bb` or bb MCP tools fail for those seconds.
  - Pending user interactions held only in server memory: not verified.

**Protocol gate.** ss:212975 rejects a daemon whose `protocolVersion !== HOST_DAEMON_PROTOCOL_VERSION`. The rejection is retryable, and the daemon only self-updates (`protocolSelfUpdater`) on a mismatch. 0.46.1 is 237, the Mac's bundled 0.47.0 is 251. So nearly every bb release needs the daemon replaced, which means interrupting running threads.

## 3. In-place restart options

**(a) `KillMode=process` or `mixed`: unsafe here.**
- It would SIGTERM only bash (MainPID). The node launcher, server, daemon and agents would be orphaned inside the cgroup.
- systemd then starts a second unit instance that collides on port 38886 and the daemon lock. The journal already shows the warning shape: "Daemon lock exists" and "Another bb already runs on this data directory" (10-22 00:35:45).
- `mixed` adds a SIGKILL of the leftovers at the stop timeout.
- It does not preserve threads, and it leaves duplicate bb processes.

**(b) Hot reload: no bb signal exists, but a restart of the server child alone works by design.**
- The server handles only SIGINT and SIGTERM (ss:228139-228145). The launcher forwards SIGINT and SIGTERM (`bb-app.js:17443-17446`). No SIGHUP or SIGUSR handler was found.
- The launcher's `superviseFullStackProcesses` (`bb-app.js:20379-20470`) restarts the server when only the server exits, after a 1 s delay. This holds unless another healthy server answers `/health` or a server-move marker exists. When the daemon exits, it restarts the daemon after 1 s.
- Hot restart is therefore `kill -TERM <server pid>`, where the server is the node child of the launcher running `server/dist/index.js`. The daemon is untouched and keeps the same instanceId. **Not run, because of the constraint. It is the candidate experiment in section 5.**
- Some settings can be changed live without any restart: `bb-app config set BB_APP_URL ...`, and `bb-app config refresh`. `BB_APP_URL`, `BB_EXTERNAL_URL`, `BB_SERVER_PORT` and similar env keys are startup-only (`bb-app env` help, `bb-app.js:19062-19070`).

**(c) bb's in-app update (`bb updates app apply`): not usable here, and not safe anyway.**
- This unit passes `--no-in-app-updates` (`bb-app.js:21019`), so it is off.
- When on, it calls `requestShutdown` for the whole stack and exits with code 75 (`APP_UPDATE_RESTART_EXIT_CODE`, `bb-app.js:18215`). The shim relaunches the launcher, which restarts the daemon too. The CLI asks before it interrupts running threads (`--yes` skips the prompt). The guide says it "does not roll back if the new version fails to start".
- The guide also says "`bb-server` cannot update itself".

**(d) Separate host daemon unit: feasible, and best as a structural step.**
- `bb-server` runs only the server (`bb-server.js:17052-17104`; usage line "bb-server [--data-dir] [--server-bind-host] [--server-port]"). `bb-host-daemon` is the standalone daemon (`dist/bb-host-daemon.js`, usage at line 17477).
- A daemon on the same data dir `~/.bb` is already enrolled: `enrolled` means `auth.json` exists (`bb-app.js:19962`). `~/.bb/host-id` and `auth.json` already exist from Oct 20. That would keep host_i9hvsvifpv, the existing environments and the "user-enrolled" role, with no re-pairing.
- Run it as `BB_SERVER_URL=http://127.0.0.1:38886 bb-host-daemon --host-daemon-port 38887`. The daemon lock (`~/.bb/daemon.lock`) is the only shared resource, and only one process may hold it.
- **Not verified:** whether the server special-cases the co-located daemon in ways a split breaks (desktop-browser broker, local `bb` CLI context via port 38887, plugin hosts).
- Do not use `Requires=`, `BindsTo=` or `PartOf=` from the daemon to the server. Those propagate restarts.
- Agents then live in the daemon unit's cgroup. Restarting that unit still interrupts threads, but it only needs to happen for a protocol bump.
- Compare the Mac: a launchd service with `host-daemon --auto-update --server-url https://bb-popemkt.taild98079.ts.net`, its own `BB_DATA_DIR=~/.bb-machines/<server>` and its own `host-id`. The server-side version of this would be a second machine on the same box, whose project environments would have to be re-pointed. I do not recommend that variant.

**(e) Socket activation or zero-downtime handoff: not available.**
- There is no `LISTEN_FDS`, `sd_notify` or `NOTIFY_SOCKET` in `bb-app.js`, `start-server.js` or `daemon-bundle.mjs` (grep count 0).
- The server listens with an ordinary `listen`. Its restart blip is about 5 s, as observed in the 10-22 and 10-24 restarts. The daemon reconnect covers that.

## 4. NixOS levers

How a switch decides, as I understand NixOS's `switch-to-configuration` (from the NixOS module docs, not tested on this host):

| Setting | Effect on this unit |
|---|---|
| default (`restartIfChanged=true`, `stopIfChanged=true`) | stopped at the start of the switch, started at the end. Anything that fails in between leaves it down, as at 00:36. Interrupts every thread. |
| `stopIfChanged=false` | one `restart` at the end. Shorter gap, but still interrupts threads. |
| `restartIfChanged=false` | a changed unit is not touched; the new definition applies at the next manual restart. This removes the switch as a source of restarts. |
| `reloadIfChanged=true` | runs `ExecReload` instead of restart. `restartIfChanged` is then ignored. Requires an ExecReload that does the right thing. |
| `restartTriggers` | extra paths whose changes force a restart. Moot with `restartIfChanged=false`, and not wanted here. |

Why the unit changes on a switch: its `Environment` and `PATH` embed store paths (bash, coreutils, glibc-locales, tzdata; see `systemctl cat app-bb`). Any nixpkgs bump changes the unit text. The unit is also restarted by `update-npm-globals` through `restart-apps-updated-by`, which runs `systemctl try-restart`, and a bb npm upgrade restarts it that way. Both paths are the cause of interruptions today.

Whether the very first switch that introduces `restartIfChanged=false` still restarts bb depends on whether the old or new unit's flag is consulted. I could not verify that. Plan for one more interruption at deploy.

## 5. Recommendation

**Principle.** Reconfiguration never touches the daemon. An upgrade replaces both processes only when no thread is active, because the protocol equality check makes it unavoidable.

**Step 1 (small, uses bb's own supervisor): hot server restart.**
In `modules/nixos/system/services.nix` and `modules/options/services.nix`, add to `my.services.<app>` a `restart` choice: `unit` (today) or `serverOnly`. For bb, set `serverOnly`:

```nix
systemd.services.app-bb = {
  restartIfChanged = false;       # a switch never stops bb
  stopIfChanged = false;
  serviceConfig = {
    ExecReload = hotRestart;      # restart the server child only
    ExecStartPost = recordProtocol;   # save the protocol bb started with
  };
};

hotRestart = pkgs.writeShellScript "app-bb-hot-restart" ''
  set -eu
  pkg=/home/popemkt/.local/lib/node_modules/bb-app
  now=$(grep -o 'HOST_DAEMON_PROTOCOL_VERSION = [0-9]*' $pkg/server/dist/start-server.js | grep -o '[0-9]*$')
  if [ "$now" != "$(cat /run/app-bb/protocol)" ]; then
    echo "protocol changed; needs a full restart when idle" >&2; exit 1
  fi
  launcher=$(pgrep -P "$MAINPID" -x node)
  server=$(pgrep -P "$launcher" -f server/dist/index.js)
  kill -TERM "$server"            # the launcher restarts it, daemon untouched
'';
```

- Add `RuntimeDirectory = "app-bb"` so `/run/app-bb` exists for the recorded protocol.
- `restart-apps-updated-by` calls `systemctl reload-or-try-restart` for apps that declare this mode, and only falls back to a full restart when the app's idle gate allows.
- Change `BB_APP_URL` live with `bb-app config set BB_APP_URL ...` instead of through the unit's environment.

**Step 2 (idle-gated full restart).** An `app-bb-restart-when-idle` service plus timer, which polls `bb thread list --json` for any status `active`. It runs `systemctl restart app-bb` only when none are, and it is the only place a full restart happens after a protocol bump. That makes the interruption a choice instead of a side effect of a switch.

**Step 3 (optional, only if Step 1 is flaky).** Split into `app-bb-server` (`bb-server`) and `app-bb-daemon` (`bb-host-daemon`) as in (d), each with `restartIfChanged=false`. It needs its own experiment.

## 6. Live experiment (requires owner go-ahead; not run)

Cost of failure: the throwaway thread T is interrupted. If other threads are active, wait. The test only starts when `bb thread list --machine shared-server --json` shows none with status `active`.

1. Baseline: record `systemctl show app-bb -p MainPID,NRestarts`, the pids of the launcher (814034), server (814120), daemon (814167), and `bb thread list`. `journalctl -u app-bb -f` runs in another terminal.
2. Create T on shared-server. Prompt: "Run `for i in $(seq 1 90); do echo tick $i; sleep 10; done` in the shell, then write DONE." Confirm ticks are advancing.
3. **Server-only restart.** `ssh popemkt@shared-server 'kill -TERM 814120'` (the current server pid). This is the only action.
4. Pass criteria:
   - Journal shows "server exited ... restarting server" and "Server listening" within about 10 s.
   - `/health` OK, and `systemctl show app-bb -p MainPID,NRestarts` is unchanged.
   - Launcher pid, daemon pid and the claude pid are all unchanged.
   - `bb thread show T` stays `active`, and `bb thread log T` has no `system/thread/interrupted` event.
   - Tick numbers continue without a gap after the server returns, and T ends with DONE.
5. Fail: if the launcher does not restart the server within 60 s, run `sudo systemctl restart app-bb` and T is interrupted. Abort the plan and reconsider Step 3.
6. **Switch test, after the module change is deployed.** Start another T, add a harmless `Environment=` entry to the unit, and `rebuild`. Pass if journalctl shows no "Stopping bb" and `MainPID` is unchanged.
7. Repeat step 6 once with the idle gate, after faking a protocol change (edit the recorded protocol file under `/run/app-bb` in a test copy) to check the refusal path.

## Not verified

- Live behaviour of a server-only restart (steps above).
- Where the daemon instanceId is generated (assumed per process, since the server's same-instance logic depends on it).
- Whether a thread on the Mac survived the 10-24 outage, and whether pending interactions survive.
- Whether `bb-server` plus `bb-host-daemon` on `~/.bb` works with the co-located-daemon special cases.
- Whether the first switch that sets `restartIfChanged=false` still restarts bb.
- Whether the 00:36 switch failure (status 101) is reproducible, and its cause.
