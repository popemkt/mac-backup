---
name: chief-mode
description: How to act as a coordinator, project chief or task architect in the chief-mode hierarchy over ordinary bb threads (cm_* tools and `bb chief-mode`). Use when a thread holds a chief-mode role, or when asked to set up, adopt into, hand off within, or read the Chief hierarchy.
---

# chief-mode

chief-mode is an overlay on ordinary bb threads. A role is this plugin's metadata on a thread,
nothing more: the thread stays visible in the sidebar, other plugins see and act on it as usual,
and the person can open any member and talk to it directly.

```
coordinator (Chief)            one, over every project
└── project chief              one per bb project
    └── task (bb Tasks, DOT-n)
        └── task architect     one per task, attached to it on the board
```

Your role, project, task and the thread you report to are in your instructions under
"chief-mode:". Each role gets only its own tools.

| Tool | Coordinator | Project chief | Architect |
|---|---|---|---|
| `cm_project_chief` stand up / adopt a project's chief | yes | | |
| `cm_handoff` give a bb Task to a new architect | yes | yes | |
| `cm_roster` the live tree with statuses | yes | yes | yes |
| `cm_report_up` report to the thread above now | | yes | yes |
| `cm_adopt` give an existing thread a role | yes | yes | |

## Reporting up happens by itself

When a project chief or architect goes idle, its **final message of the turn** is sent to the
thread in its `reportsTo` (after a short quiet period; one report per turn; capped per hour).
So end every turn with a short status the thread above can act on:

- **Done**: what changed, where (PR, files), what was verified.
- **Blocked**: what on, and what you need.
- **Needs a decision**: the question and your recommendation.

Use `cm_report_up` only for a report in the middle of a turn, or when the report should differ from
your final message; that turn's automatic report then stands down. Reports arrive as messages
starting with `[chief-mode report]`. Do not reply to a report just to acknowledge it.

## Coordinator

- Do not do project work. Give each project a chief: `cm_project_chief` with the project
  (`proj_…` or its name) and a charter. It returns the existing chief if there is one; pass
  `adoptThreadId` to promote a thread the person already uses.
- Send work to a chief with `bb thread tell <chief> '…'`, or hand a specific task down with
  `cm_handoff` when the person names one.
- Read state with `cm_roster`, never from memory. Summarize for the person: what finished, what
  is blocked, what waits on them (rows marked "waiting on you" have a pending approval or question
  in that thread; point the person at it).

## Project chief

- Turn requests into bb Tasks (`bb tasks create …`, or `cm_handoff` with `title` to create and
  hand off in one step) and give each to an architect with `cm_handoff` and a complete brief:
  mission, acceptance criteria, constraints, what is out of scope.
- `cm_handoff` with an existing key whose task already has an architect sends the brief to that
  architect instead of spawning a second one (`force: true` spawns another).
- Follow architects' reports; decide what you can, escalate decisions that are the person's.
- Your final message goes to the coordinator: make it a project-level digest, not a relay.

## Task architect

- You own the task end to end: do the work, or spawn helpers yourself and stay the accountable
  thread. Keep the task honest with `bb tasks update <KEY> --status …`.
- When blocked, say so in your final message; the chief receives it.

## Joining and leaving the hierarchy

Any thread can take a role, and leave it, without changing anything else about the thread:

```bash
bb chief-mode adopt self --role coordinator
bb chief-mode adopt thr_abc123 --role project-chief --project .dotfiles
bb chief-mode adopt thr_def456 --role architect --task DOT-12      # also attaches it to DOT-12
bb chief-mode drop thr_def456                                       # removes the role only
```

`--reports-to <thread>` sets the link explicitly; by default an architect reports to its
project's chief and a chief to the coordinator.

## Other commands

```bash
bb chief-mode roster [--project <id|name>] [--json]
bb chief-mode handoff DOT-12 --brief '…' [--from <thread>] [--workspace new-worktree] [--force]
bb chief-mode status [--rebuild] [--json]
bb chief-mode report --text '…'          # the CLI form of cm_report_up
```

A thread that was **adopted** while its agent session was already running does not get the
`cm_*` tools until bb builds it a new provider session; until then it uses these commands
(`roster`, `handoff`, `adopt`, `report`), which do the same thing. Its automatic report-up works
from the moment it is adopted.

`status --rebuild` rescans every thread's metadata, which is the source of truth; use it after a
role was written by something other than chief-mode.

## What chief-mode never does

It never hides, archives or deletes threads, never sets `parentThreadId` (archive and delete would
cascade), and never writes another plugin's data. A spawned thread is a normal thread of its
project; the role is written before its first turn so the right tools are there from the start.
