---
name: session-import
description: Continue a Claude Code session that ran outside bb (in a terminal, an IDE, T3 Code) as a new bb thread, from any machine bb reaches. Use when asked to import, bring over, continue or hand off a Claude Code session, or to find one by directory or time.
---

# Session import

`bb session-import` lists Claude Code sessions on the machines bb reaches and starts a bb thread from one.

```sh
bb session-import machines                          # machines bb reaches
bb session-import list --machine popemkt-work       # last 30 days there, newest first
bb session-import list --all --cwd .dotfiles        # every session whose directory mentions .dotfiles
bb session-import show <session-id> --machine m     # what an import would send, and where it would run
bb session-import import <session-id> --machine m --prompt "Finish the migration"
bb session-import import <session-id> --machine m --to shared-server   # run the thread on another machine
bb session-import sync <thread-id>                  # send an imported thread the turns its session gained since
```

Without `--machine`, the bb server's own machine is used. The thread runs on the session's machine, in its
directory, in the bb project that directory belongs to (`--project <id>` overrides; `--to` picks another
machine, which then uses the project's own source there).

What the new thread gets: first a short "Where the session stood", built from the records (files changed and
only read, the last todo list, a tool call left without a result, the last message each way); then the transcript with every message, one line per tool call, no tool output and no
thinking, cut to about 40k tokens (`--budget N`). Older history goes first: before the latest compaction it
becomes Claude Code's own summary, then older turns lose their tool lines, then the oldest turns are left out,
keeping the first request; the "Where the session stood" part is never cut. Failed tool calls keep the start of
their error. The complete transcript is attached as a file for anything left out.

If the source session goes on after the import, `sync` sends the new turns to the thread (agent-only, with a
visible message) and refuses when the session was rewound or rewritten before the import point.

This is a handoff, not a resume: the new thread runs a new Claude Code session and the source session file is
never changed. A session that a bb thread already runs shows `[in bb: <thread>]`; continue that thread instead.
The person can also use **Import sessions** in bb's navigation, and **Original session** in an imported
thread's side panel shows the source session with tool output on demand.
