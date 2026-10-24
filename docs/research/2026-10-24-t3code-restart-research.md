# T3 Code: process topology across restarts and upgrades

Source read: github.com/pingdotgg/t3code, shallow clone at `/tmp/t3code-research/src` (HEAD 3f3a1bf4, 2026-10-23). Nothing was run or built. Paths are relative to the repo root. Docs are cited where they state a design decision; the code line is cited wherever I checked it.

## 0. Headline

T3 does not keep agents alive across a server restart. The server is the parent of every agent process, and a server restart or update kills them. T3 instead makes the interruption cheap and recoverable:

1. All state is an event log in SQLite, so the server can restart and rebuild everything.
2. On shutdown it records "continue this run" intents in a durable outbox. On startup it resumes the provider's native session (`thread/resume` for Codex, `resume` for Claude) and sends a continuation prompt.
3. Its update path is two-phase (trial child, commit, DB rollback), with a stable launcher process above the server that survives updates.
4. The client/server version gate is a coarse integer protocol, not the release version, so most releases do not force a server restart for compatibility reasons.

This is the opposite of bb's design for agent survival (separate daemon holds agents), and it solves a different half of the problem. It is still useful to copy parts of it (section 6).

## 1. Process model

Processes:

| Process | What it is |
|---|---|
| Desktop shell | Electron main plus renderer. It bundles a server and spawns it as a child, in Node mode. `apps/desktop/src/backend/DesktopBackendManager.ts:425-450` (spawn with `killSignal: "SIGTERM"`, `forceKillAfter` 5 s). A pool can hold several backends, for example WSL plus Windows (`DesktopBackendPool.ts`). |
| Server | One Node process per environment: `apps/server`. A WebSocket and HTTP server that owns orchestration, providers, terminals, git and checkpoints. `AGENTS.md` "How it works" says "Provider CLIs run as subprocesses". |
| Agent processes | Children of the server, with no intermediate daemon. Codex: `codex app-server` spawned through `ChildProcessSpawner` inside the server's scope (`apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:1585-1599`; one app-server shared by threads of a session, `:1816`). Claude: the Claude SDK spawns the CLI. T3 wraps it in `spawnClaudeProcessGroup` (`ClaudeAdapterV2.ts:334-358`), which runs `/bin/sh` with `detached: true` and its own process group. |
| Optional service launcher | A tiny stable supervisor (`apps/server/src/serviceLauncher.ts`) installed as the systemd/launchd unit by `t3 service install`. It spawns the server as a child. It has no Effect runtime and "must keep working across server versions" (`:1-5`). |

Which process is the parent of agent sessions: the server. Evidence that agents die with it:

- Claude agents have a watchdog. `ClaudeAdapterV2.ts:318-332` and `:313-316` (`CLAUDE_GROUP_WATCH_SCRIPT`) say that a server that "crashes or is killed would leave the CLI working next to the session it resumes (#23370), so a watcher in the group reads a pipe only this server holds and stops the group at its end-of-file". The design goal is that agents die when the server dies.
- The desktop manager comment says "A killed backend leaves its agents running, and a busy one needs a few seconds to stop every provider session" (`DesktopBackendManager.ts:40-41`). A hard kill is the accident case, and the graceful path is the one that stops providers.
- Shutdown calls `providerSessions.shutdown` (`serverRuntimeStartup.ts:484-486`).

Remote or separate server, one central or one per client:

- Each environment is one server plus its machine, filesystem and state: `AGENTS.md` glossary ("environment means one running T3 server and the machine, filesystem, provider credentials, and state it owns") and `docs/internals/overview.md` ("execution in the environment that owns the workspace... controlled over authenticated RPC").
- Clients are web, desktop and mobile. A client holds a catalog of saved environments and connects to any of them. `docs/internals/remote.md`: "Each connection joins a client to one environment". Routes can be LAN, Tailscale, SSH or the T3 Connect tunnel.
- So there is no central server. It is one server per workspace-owning machine, and a client may hold many connections. The desktop's bundled server is merely the default "primary" environment, and it can also act as the host for remote clients (`AGENTS.md` "Multi-surface").
- Single-owner guard: `apps/server/src/serverOwnership.ts:~170-210` takes an exclusive SQLite transaction on `server-owner.sqlite` in the state dir. A second server on the same home exits with code 78 (`SERVER_EXIT_CODE_STATE_DIR_OWNED`). The OS releases the lock on SIGKILL, and the launcher idles rather than looping on that exit code (`serviceLauncher.ts:#idleWhileStateDirOwned`, ~`:816-835`).

## 2. What happens to a running turn

### (a) Server process restarts

Agents are children of the server, so they stop. The turn is interrupted and then optionally continued.

Graceful shutdown (`apps/server/src/serverRuntimeStartup.ts:466-494`, the layer finalizer):

1. Fail the command gate and interrupt the effect worker.
2. `providerRuntimeRecovery.prepareForShutdown`. For each thread with a continuable run it writes a `provider-runtime.continue` effect into the durable outbox, if the `continueThreadsAfterServerUpdate` setting is on (`ProviderRuntimeRecoveryService.ts:755-789`; setting at `packages/contracts/src/settings.ts:998,1042`).
3. `providerSessions.shutdown` stops provider processes.
4. `reconcile("shutdown")` marks the unfinished runs, tool requests and approvals as cancelled ("Cancelled because the server shut down before the provider work completed", `ProviderRuntimeRecoveryService.ts:249`).

Startup: `recover` runs `reconcile("startup")` (`:795-797`; ordering in `serverRuntimeStartup.ts:~444-449`: recover, then delegated tasks, then effect worker). It:

- terminalizes every run still in `preparing/starting/running/waiting` (`:81-91`, `nonterminalRuns`; `:198-262`);
- expires pending runtime requests (`:346-349`);
- cancels outbox effects that were bound to the dead process (`PROCESS_BOUND_EFFECT_TYPES`, `:640-660`);
- queues a continuation via `restartContinuationRun` when the preference is on (`:625-640`; `RestartContinuation.ts`).

The continuation re-opens the provider session and resumes by native identity: Codex `thread/resume` (`CodexAdapterV2.ts:6723-6730`), Claude `resume: nativeThreadId` (`ClaudeAdapterV2.ts:1339-1340`). It requires "matching durable run, provider thread, session, and native resume identity" (`docs/internals/server-updates.md`, "Recovering interrupted threads").

Limits, from `docs/internals/server-updates.md` and the user docs:

- It is a restart plus resume. It is not a continuous turn. The in-flight provider turn is cut, then a continuation prompt is sent.
- Pending approvals, questions and secrets are not preserved for Claude. `pendingRequestsSurviveRestart: false` (`ClaudeAdapterV2.ts:244`, and the same flag in the Codex capabilities). A thread waiting for user input is not resumed.
- Background shells and dev servers are not woken. The thread learns about them at the next user message.
- A cap of 3 consecutive automatic continuations (`RestartContinuation.ts:33`, `MAX_CONTINUATION_CHAIN`) stops a crash loop.
- Terminal commands may still be interrupted (`docs/user/updating.md`).

Crash (no graceful shutdown): the SIGKILL case. The lock frees, and startup reconciliation still runs. The prepared outbox intent is absent, but `reconcile("startup")` computes a continuation from the durable projection (`restartContinuationRun` over `sessionsLiveAtStart`). The docs say the setting "resumes supported active threads after an update, crash, or machine restart".

### (b) App updates to a new version

Two update paths.

**Desktop app (Electron).** `apps/desktop/src/updates/DesktopUpdates.ts:740-765`: it writes a restart marker, stops every backend in the pool with a 5 s timeout, then calls `electronUpdater.quitAndInstall`. Agents therefore die with the backend. The server's shutdown checks `desktopUpdateRestartPending` (`cloud/updateHandoff.ts`, 1 minute marker TTL) so it treats the stop as a planned restart.

**Boot-service server (launcher).** This is the sophisticated one. `docs/internals/server-updates.md` and `serviceLauncher.ts`:

1. The active server child sends `request-update` over inherited Node IPC (`serviceProtocol.ts:41-50`). The launcher checks that the requester is the active child, that no other update is pending, that the target is an exact and newer version, and that the runtime is installed (`serviceLauncher.ts:669-715`). It also checks that disk space fits a DB backup before stopping anything (`databaseBackupBlocker`, `:230-255`).
2. It writes a `pending` record durably (fsync + atomic rename, `writeServiceState`, `:405-420`), replies `update-accepted`, and after 2 s (`HANDOFF_DELAY_MS`, `:35`) stops the old child.
3. It snapshots SQLite (main, WAL, shm) with an APFS or reflink clone (`backupDatabaseOnce`, `:~280-310`), then starts the new version as a trial child (`#startTrial`).
4. The trial runs migrations, binds HTTP, parks its long-running roots at an activation gate, and reports `prepared` (`serviceProtocol.ts:47-50`). The launcher commits `activeVersion` durably and replies `committed` (`#handlePrepared`, `:744-770`). Only then does the child accept commands and start agents.
5. If the trial crashes or times out (30 min, `PREPARED_TIMEOUT_MS`, `:~40`) the launcher restores the DB snapshot and restarts the old version (`#returnToPrevious`, `:840-870`).

During this, the old server's agents are killed at step 2. There is no wait-for-idle. The path preserves the DB and resumes interrupted threads through the continuation mechanism in (a). `selfUpdate.ts` `withRunningThreadContinuation` (`:70-130`) calls `prepare` at the "installing" stage so continuation intents are written before the handoff, and it clears them if the update fails before handoff.

### (c) Client UI reloads or disconnects

Agent turns are unaffected. The server owns execution, and a turn continues with no client attached (`docs/internals/overview.md`, "Thread settlement is server-owned... without a connected client").

- Reconnect and replay: clients keep a replay cursor and resume with `afterSequence` (`packages/client-runtime/src/state/threads.ts:240-270,470-490`). The server replays events after that sequence, and falls back to a snapshot if the gap is too large (`apps/server/src/ws.ts:726-745`, `replayGap > maxGap`).
- Retry policy: one supervisor owns reconnects, with jittered exponential backoff capped at 5 minutes (`docs/internals/connection-runtime.md`).
- The client cache keeps state and cursor for 5 idle minutes. The desktop keeps every running thread's stream mounted so opening one needs no replay.

### State persistence

Event-sourced SQLite. `docs/internals/overview.md` "Durable intent and side effects": the event log is the source of truth. `EventSink` commits events, projections, the command receipt and outbox effects in one transaction. An effect worker runs side effects after commit, and results feed back as commands. Persisted events "must remain decodable on replay". Per-turn checkpoints are hidden git refs. The DB file is `userdata/statev2.sqlite`.

## 3. Versioning

Client to server: a strict equality check, but on a coarse protocol integer, not the release version.

- `packages/contracts/src/environment.ts:12-15`: `ORCHESTRATION_PROTOCOL_VERSION = 2`, sent as the `orchestrationProtocol` query parameter.
- Server: `apps/server/src/ws.ts:627-631` (equality) and `:3205-3217` (HTTP 426 with code `orchestration_protocol_incompatible`).
- Client: `packages/client-runtime/src/connection/compatibility.ts` compares the descriptor's `orchestrationProtocolVersion` (default 1 for old servers). A newer server blocks the client with "Update your app". An older server blocks it with "Update T3 Code on <machine>", and offers one-click update if the server is self-updatable.
- A blocked client can still reach the outdated server and update it through a protocol-independent path (`outdatedHostUpdate.ts:66-75`). The gate is on the main session only.
- Because the integer only moves on breaking wire changes, ordinary releases do not force a restart of anything for compatibility. A release does restart the server, but that is the update itself, not a handshake requirement.
- Feature gating is by capability flags in the environment descriptor, "never through a client version" (`docs/internals/overview.md`, "Pull request linking compatibility"). The server keeps accepting legacy commands and emitting legacy fields.

Server to agent: no protocol-version lock.

- Provider CLIs are the user's own installs, with semver-range policies. `apps/server/src/provider/providerCompatibility.ts:20-40` defines `t3CodeRange`, `recommendedRange` and per-range status. The server still runs an out-of-range provider and surfaces an advisory.
- The agent protocol is negotiated by the protocol itself (Codex `initialize` with client capabilities, `CodexAdapterV2.ts:~1830-1840`). The generated schema lives in `packages/effect-codex-app-server`.
- Provider updates "do not restart running chats. An existing session can keep using the previous CLI until it ends" (`docs/user/updating.md`). The Antigravity installer uses immutable releases, an atomic pointer for new processes, and leases for running ones (`docs/internals/providers.md`; `AntigravityInstallation.ts:89`).

## 4. Update mechanism

- Ask, not wait. There is no wait-for-idle. The UI shows a confirmation that states how many running threads "will be interrupted and can resume after the restart" (`apps/web/src/components/sidebar/UpdateEverythingDialog.tsx:85-105`). `t3 update` on the host "asks first" before restarting the service, and a "no" leaves the old version running until `t3 service restart` (`docs/user/background-service.md`; the `.restart-pending` marker, `serviceProtocol.ts:13-17`).
- The desktop shows a countdown and a "Later" choice, and Settings has the "Continue threads after restarts" option.
- No hot reload, no FD passing, no old-process-stays-alive. The old child is stopped (SIGTERM, 5 s, SIGKILL; `terminateChild`, `serviceLauncher.ts:~440`) before the trial starts, because both need the same SQLite DB and the ownership lock. The launcher itself is the one process that stays up across a version change.
- Rollback is real: DB snapshot restore, a durable restore marker so an interrupted restore completes before either version boots (`:~345-380`), and an outcome record the client correlates by update ID after reconnect.
- Desktop installs are two-phase with a token, so the success RPC result is not lost when the backend stops (`docs/internals/server-updates.md`, "Client acknowledgement").

## 5. Evidence about "agents survive a restart"

No part of the repo keeps an agent alive across a server process. I searched for `detached`, `unref` and `setsid` use: the only agent detach is the Claude process-group wrapper above, which is designed to kill the group. Codex app-server is scoped. OpenCode 2.x runs a server per instance (`docs/internals/providers.md`) and an "external" OpenCode server is externally owned, but its sessions are re-attached through the adapter, not through any T3 daemon. I did not read the OpenCode adapter in depth.

## 6. Lessons for bb

bb already has what T3 lacks: a daemon that outlives the server, with buffered reconnect, so a server restart is harmless. T3's contribution is what to do when the daemon does have to go.

1. **Resume instead of interrupt.** When a daemon restart is unavoidable, write a durable continuation intent per active thread before shutdown, record the provider's native session identity, and on daemon start resume that session with a continuation prompt. T3 does this with `prepareForShutdown` then `reconcile("startup")`, and caps it at 3 chained resumes. For bb, the server could persist `{thread, provider session id, run id}` when it sees `host-daemon-restarted` and re-dispatch after the new daemon connects. Today bb marks the thread interrupted (`host-daemon-restarted`, per the investigation doc). Whether bb's providers (claude-code, codex) can resume by native id is something bb already knows better than I do. It is the highest-value copy.
2. **Make the compat gate coarse.** T3's gate is an integer that moves only on breaking wire changes, plus capability flags in the descriptor. bb's exact protocol equality (237 vs 251) turns every release into a daemon restart. Split bb's protocol into a compatibility epoch (equality required, bumped rarely) and a minor/capability set (ranges). The server would accept any daemon whose epoch matches and whose capabilities cover the features it uses. This removes the forced restart for most releases. It is the structural fix.
3. **Gate restarts on idle, and show the cost.** T3's UI states the number of threads that would be interrupted and how many can resume. bb's restart-when-idle timer (section 5 step 2 of the investigation doc) matches the spirit, and T3 offers a "Later" choice and a `.restart-pending` marker so status can say "running old version, restart pending". Copy the marker: the daemon reports "behind its unit".
4. **Keep the supervisor dumb and stable.** T3's launcher has no Effect runtime and a versioned protocol constant, and it survives server updates. bb's launcher already supervises both children. Keeping it version-independent is what allows the server-only restart.
5. **Two-phase commit for upgrades.** Start the new version as a trial, commit only after it reports ready, roll back otherwise. This fixes the 10-minute failed-switch outage class (stop, then nothing started). bb could at least do the cheaper half: record intent, start the new server child first, and only then stop the old one. The server restart is already safe, so a trial server on the same data dir needs only a port or lock handoff.
6. **Leases on installed versions.** T3 keeps immutable versioned runtimes and lets running processes hold a lease, so an upgrade never replaces files under a running agent (Antigravity installer). bb's `npm -g` install replaces the package in place under a running daemon. Versioned install dirs plus an atomic pointer would let a new daemon start while the old one finishes its threads, which is the missing "old process drains" path. That would give a real drain: new daemon takes new threads, old daemon exits when its last thread ends. T3 does not do this for its own server. It is a design bb could do that T3 does not.
7. **Process-group watchdog for agents.** If bb ever splits the daemon into its own unit, copy the pipe-EOF watchdog idea so orphaned agents do not run beside their resumed session (`ClaudeAdapterV2.ts:318-332`).
8. **Counter-lesson.** T3 accepts that agents die with the server and pays for it with resume machinery. bb should not give up the daemon split. Resume (lesson 1) should be the fallback for the cases the daemon cannot cover (protocol bump, host reboot), not a replacement.

## 7. What I could not verify

- Whether T3 users see resumed Codex or Claude turns pick up mid-tool-call cleanly. I only read the mechanism and the documented limits. No tests were run.
- The OpenCode adapters and the `external` server path were not read in depth, so I cannot say whether OpenCode sessions survive a T3 restart when the OpenCode server is externally owned (`docs/internals/providers.md` says it can).
- The remote-update path in full: I read the launcher and `selfUpdate.ts` heads and `withRunningThreadContinuation`, not the `respawn` method for foreground servers or the `desktop-app` method end to end.
- Line numbers marked `~` are approximate (read from partial views). Others were read directly in this checkout.
- GitHub issues and discussions were not consulted (the GitHub MCP was unavailable and I stayed on source and in-repo docs). Reported field behavior (for example whether continuation is reliable in practice) is therefore unchecked.
- The `.repos/` vendored references and the mobile app were not examined.
