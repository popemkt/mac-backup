# bb-plugin-restart-resume

Continue threads that a bb restart interrupted, and show on every thread why its last turn
stopped. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for what a person gets.

Both halves read the same interruption events and the same per-thread resume record, so the
indicator's "auto-resumed 1/3" is the resumer's own state, not a second guess at it. That is why the
indicator lives here rather than in a plugin of its own; the name stays, because renaming the
plugin id would orphan its stored records and settings on every install.

## What bb does (0.46.1, `server/dist/start-server.js`)

- bb interrupts threads only when a host daemon's session opens (`handleHostSessionOpened`): a
  new daemon process interrupts every active thread on that host, and the same process
  interrupts the active threads it no longer reports. Both append `system/thread/interrupted`
  with `reason: "host-daemon-restarted"`; the second adds `cause: "host-connection-lost"`. A
  server restart alone interrupts nothing.
- The interruption is a `run.failed`: the thread lands in `error`, and plugins get
  `thread.failed` (and `turn.failed`).
- A message sent to an `error` thread starts a turn, and the turn carries the thread's stored
  provider session, which a fresh daemon resumes. So a plain `threads.send` continues the
  agent's own conversation.

## How it works

| File | Role |
|---|---|
| `core/policy.ts` | Pure: settings parsing, which interruption is resumed (`decide`), the cap and dedup record, the message. |
| `core/resumer.ts` | The one resume path over a port: read facts, decide, claim, send. Guards concurrent triggers. |
| `server.ts` | Binds the port to the plugin SDK and fires the resumer on `thread.failed`, on a host reconnecting (`host:changed` → `host-connected`, then a sweep 5 s later), and on start. |
| `core/stops.ts` | Pure: which interruption still stands (`standingInterruption`), its kind and actor, the resume state, and how it reads (`present`); the sidebar row diff. |
| `app.tsx`, `adapter/` | The indicator: a content script that holds bb's row-status setter, an invisible app overlay that fetches and mirrors stops, the thread header badge. |
| `skills/restart-resume/` | Tells an agent what the continuation message is. |
| `tests/` | The policy, the stop logic, and the resumer against an in-memory bb. |

A thread is resumed when all hold:

1. its status is `error` and it is not archived;
2. its newest turn-boundary event (`client/turn/requested`, `turn/started`, `turn/completed`,
   `system/thread/interrupted`) is an interruption with reason `host-daemon-restarted`;
3. that interruption is inside the window and newer than the one the plugin last resumed;
4. the cut turn was not waiting on the person: no question, approval or permission it raised
   (`system/interaction/lifecycle` and the older per-kind lifecycle events after its
   `turn/started`) ended other than `resolved`. bb marks one open at the cut `interrupted`, and it
   does not survive the restart, so the person answers first, as in T3 Code;
5. fewer than `maxConsecutive` resumes ran since a turn last completed normally;
6. no ancestor covers it. bb tells a parent when its child is interrupted, so a parent resumed
   for the same restart (now, or inside the window) re-drives the child, and the child gets no
   message of its own. A child whose parent is not resumed (still running, stopped by hand,
   capped, on another machine) is resumed itself.

Skips for 4, 5 and 6 are logged ("not resumed: was waiting on user", "… resumes in a row …",
"… its parent is resumed and re-drives it").

The per-thread record (`bb.storage.kv`, `thread:<id>`: `chain`, `interruptionSeq`, `resumedAt`)
is written before the message is sent, so a failed or repeated trigger never sends twice. A
failed send is logged and not retried for that interruption.

Each resume is visible in the thread as the message itself, which ends with
"(auto-resumed after restart, n of max)", and in `bb plugin logs restart-resume`.

## Why a thread stopped

A thread shows a stop while its latest turn ended with an interruption: the newest
`system/thread/interrupted` with no later `turn/completed` whose status is not `interrupted` (bb
writes the cut turn's `turn/completed {status: "interrupted"}` before the interruption on a restart
and after it on a manual stop). A later turn that completes, or fails, clears it.

| reason (+ cause) | Badge | By |
|---|---|---|
| `manual-stop` | Stopped | you or an agent: bb does not record which |
| `host-daemon-restarted` | Daemon restart → resumed 1/3, resuming, waiting on you, cap reached, … | bb |
| `host-daemon-restarted` + `host-connection-lost` | Connection lost → … | bb |
| `host-removed` | Host removed | bb |
| `provider-turn-idle` | Turn idle | bb |

Surfaces (SDK 0.6.49, all experimental):

- **Sidebar row**: the content-script context's `experimental_setThreadRowStatus(threadId,
  { icon, label, tone })`, which bb's own list draws in place of the draft glyph. bb's
  `runtime`, `unread-error` and `waiting-for-input` glyphs still win over it. The other candidates
  do not fit: `PluginSidebarThreadIndicator`, `PluginThreadStatusGlyphProps` and
  `PluginThreadTitleProps` are inputs for a plugin that replaces the whole thread list.
- **Thread header**: `experimental_threadHeaderAction`, a pill with the details as its tooltip and,
  on click, a toast: reason, who, when, and the auto-resume state.

Data flow, with no polling: the `stops` RPC answers a batch of threads from `resumer.stop` (one
event read per thread, plus the resume record and policy decision for a restart). The server
publishes the `stops` realtime signal `{ threadId }` on `thread.failed` (after the resumer acted),
`thread.idle`, `thread.active`, `thread.archived`, `thread.unarchived` and `thread.deleted`; the
frontend refetches that one thread, refetches everything after a reconnect, and fetches threads
new to the sidebar once.

### Who stopped it

bb 0.46.1 cannot tell "stopped by you" from "stopped by another agent". The interruption's data
is `{ reason, cause? }` only (`systemThreadInterruptedEventDataSchema`, `start-server.js`
:18051-18054), the events table has no actor column (:38133-38150), and the stop route
`POST /threads/:id/stop` ignores who called it (:188417-188425) before stopping with
`manualThreadStopArgs` → `reason: "manual-stop"` (:88577-88584). The UI's stop button, `bb thread
stop` in a terminal and an agent's `bb thread stop` all land there. So the badge says "Stopped" and
the tooltip "you or an agent (bb does not record which)".

## Live test

Not yet run (a `#gap` node in `.kb/nodes.jsonl`). It restarts the host daemon, which interrupts
every active thread on that machine, so it needs the owner's go-ahead and a moment when
`bb thread list --machine shared-server --json` shows no other thread `active`.

1. After the rebuild that installs the plugin: `bb plugin list` shows `restart-resume` loaded,
   with its `watch` service running, and `bb plugin logs restart-resume` has no warnings.
2. Start a throwaway thread T on shared-server with a long turn, e.g. "Run `sleep 600`, then
   say done." Wait until `bb thread show T` is `active`.
3. Restart only the daemon (with the owner's consent): its unit, once bb is split into
   `app-bb-server` and `app-bb-daemon`, else the whole bb unit.
4. Within a minute: `bb thread log T` shows `system/thread/interrupted` with
   `reason: host-daemon-restarted`, then a message ending in
   "(auto-resumed after restart, 1 of 3)", then a new turn; `bb plugin logs restart-resume`
   has "T: auto-resumed after restart (1 of 3 …)". The new turn's agent still knows the task
   (its provider session was resumed).
5. Dedup: `bb plugin reload restart-resume` (a start sweep) sends nothing more to T.
6. Cap: interrupt T's resumed turns twice more the same way: messages 2 of 3 and 3 of 3 arrive;
   a fourth interruption logs "not resumed: 3 resumes in a row" and sends nothing.
7. Negative: `bb thread stop` on a running thread sends nothing. A thread that asked the person a
   question and was cut while waiting gets nothing and logs "was waiting on user".
8. Parent and child: a throwaway thread that spawns a child running `sleep 600`, both active at
   the restart: only the parent gets the message, and it re-drives the child.
9. Archive the throwaway threads.

The indicator (its own `#gap` node):

10. During step 4: T's sidebar row shows the reload glyph labelled "Last turn interrupted: Daemon
    restart → resumed 1/3" and its header the same pill; both clear once the resumed turn
    completes.
11. `bb thread stop` a running throwaway thread: "Stopped", tooltip "By: you or an agent".
12. Check the icon names (`Square`, `RotateCcw`, `CloudOff`, `Delete`, `Pause`, `AlertCircle`,
    `ArrowReloadHorizontal`) render; bb draws a row status's icon as given, without a fallback.

## Develop

```sh
npm install --include=dev
npm run verify             # typecheck, lint, tests, bb plugin build
bb plugin install .        # or: bb plugin reload restart-resume
```

Installed by `modules/common/home-manager/bb-plugins/`, listed in the bb stack's
`my.pkgs.bbPlugins`.
