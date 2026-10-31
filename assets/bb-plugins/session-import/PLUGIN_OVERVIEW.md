Continue a Claude Code session that ran outside bb, as a bb thread.

## What you get
- **Import sessions** in the navigation, and **Import Claude Code session** in the New thread screen's right
  panel. Both open the same picker: every machine bb reaches, then that machine's Claude Code sessions, newest
  first (the last 30 days, or all), with a filter over title, first prompt and directory. A session that a bb
  thread already runs, or that was imported before, says so.
- Picking a session shows where the new thread would run: by default **the same machine and the session's own
  directory**, in the bb project that directory belongs to. Project and machine can be changed. It also shows how
  much of the transcript the thread gets.
- **Import as a new thread** starts a thread whose first turn carries "Where the session stood" (files changed
  and read, open todos, an unfinished tool call, the last words each way, all taken from the records) and then
  the cleaned transcript: every message, one line per tool call, no tool output, no thinking. The complete transcript also goes along as a file. Your
  optional first message follows; without one, the agent summarises where the session stood in five lines.
- On an imported thread, the side panel's **Original session** tab shows the source session read-only: every
  turn, compactions, and each tool call's output on demand. If the session went on after the import, it says how
  many turns and **Send them to this thread** passes them on.
- `bb session-import` does the same from a terminal or an agent.

## What it does not do
It does not resume the session itself. bb cannot yet adopt an outside session (get-bb/bb#3260), so this is a
handoff: a new Claude Code session that starts from the transcript. The source session file is never written.
