# bb-plugin-chief-mode

This plugin runs the Chief hierarchy (coordinator → project chief → task architect) as an overlay
on ordinary bb threads. [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md) covers what a person gets, and
[skills/chief-mode/SKILL.md](skills/chief-mode/SKILL.md) covers what an agent does.

It reimplements the ideas of dilipgv's command-center plugin and shares none of its code
(command-center has no license). The two can run side by side: their tool names differ (`cm_*`
here, `chief_*` there) and they keep separate state.

## Design

- **Threads stay plain.** Threads are spawned with plain `threads.spawn`:
  - visible, using the project's default environment and provider;
  - `origin: "sdk"`;
  - no `pluginMetadata` seed, because a seed attributes the thread to this plugin;
  - no `parentThreadId`, because archive and delete cascade along it.

  The role is written afterwards with `threads.updatePluginMetadata`. The first message is held
  back (`sendAt`, then sent through `queuedMessages.send`) until the role exists. That way the
  first turn's session already has the role's tools.
- **Source of truth.** A thread's role and links live in this plugin's metadata namespace:
  `{ v, role, projectId, taskKey, taskId, reportsTo, since, autoReport }`. The task link also lives
  in bb Tasks' own thread attachment. `core/members.ts` caches the roles in kv. That cache is
  rebuilt from metadata on start, every 10 minutes, and on `bb chief-mode status --rebuild`. A
  write made during a rebuild is replayed over the rebuild's result.
- **Role gating.** One table in `core/gating.ts` decides which tools each role gets. It is used by
  `agents.configure`, keyed on `context.pluginMetadata`, and again inside every tool, because a
  session's tools are fixed when the session starts. Metadata is untrusted input: it is parsed at
  the boundary, quoted in instructions, and only ever enables actions any agent may already take
  with `bb thread`.
- **Tasks.** The built-in tasks plugin is called through `plugins.callRpc`:
  - methods used: `getTaskByKey`, `createTask`, `boardMove`, `updateTask`, `taskThreadsAttach`,
    `listTaskThreads`, `listProjects`;
  - outputs are parsed loosely in `adapter/tasks.ts`, because that contract is internal to bb;
  - Tasks emits no events, so the roster re-reads task facts with a 20-second cache, and the page
    polls every 15 seconds.
- **Report-up.** `core/reporter.ts` runs on `thread.idle`. It waits for a quiet window (20 s by
  default). It skips:
  - coordinators;
  - roles turned off in settings;
  - threads with `autoReport: false`;
  - reportsTo chains that loop;
  - text identical to the previous report;
  - a turn in which the agent already called `cm_report_up`;
  - reports beyond the hourly cap (8 by default).

## Layout

| File | Role |
|---|---|
| `core/model.ts` | Roles, metadata parsing and validation, cycle check. |
| `core/gating.ts` | Tools per role, refusals, role instructions. |
| `core/members.ts` | The member index and its rebuild from metadata. |
| `core/tree.ts` | The roster tree and its text form. |
| `core/orchestrator.ts` | `ensureProjectChief` and `handoff` over a port. |
| `core/reporter.ts` | Automatic and manual report-up. |
| `adapter/bb.ts`, `adapter/tasks.ts` | Wire the core's ports to the bb SDK and the Tasks RPC. |
| `server.ts` | Settings, RPC, agent tools, events, the index service, the CLI. |
| `app.tsx`, `ui/ChiefPage.tsx` | The Chief page (a `navPanel`) and its badge. |

## Develop

```bash
npm install && npm rebuild better-sqlite3   # the fake plugin host in tests needs it
npm run typecheck && npm test
bb plugin build .
bb-plugins-sync --path "$PWD"                # try it in your bb without a rebuild
bb plugin remove chief-mode                  # uninstall it again
```

## Known gaps

- A thread **adopted** while its agent session already runs gets no `cm_*` tools until bb builds
  it a new provider session. Stopping and resuming the thread was not enough in testing. Until
  then it uses `bb chief-mode …`, which offers the same actions. Its automatic report-up works
  from the moment it is adopted.
- bb's `startedOnBehalfOf` attribution needs a parent or source thread, so a spawned thread
  records no requesting agent. The brief names the thread it reports to instead.
- A pending interaction (an approval or question) shows as "needs you" on the page, through
  `hasPendingInteraction`. `interaction.pending` only triggers a refresh. Nothing is pushed to the
  coordinator.
- Out of scope for now:
  - replacing the whole thread list;
  - a Captain inbox;
  - voice;
  - scheduled captains;
  - migrating command-center's history.
