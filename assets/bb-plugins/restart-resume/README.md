# bb-plugin-restart-resume

Continue threads that a bb restart interrupted. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) for
what a person gets.

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
| `skills/restart-resume/` | Tells an agent what the continuation message is. |
| `tests/` | The policy, and the resumer against an in-memory bb. |

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

## Develop

```sh
npm install --include=dev
npm run verify             # typecheck, lint, tests, bb plugin build
bb plugin install .        # or: bb plugin reload restart-resume
```

Installed by `modules/common/home-manager/bb-plugins.nix`, listed in the bb stack's
`my.pkgs.bbPlugins`.
