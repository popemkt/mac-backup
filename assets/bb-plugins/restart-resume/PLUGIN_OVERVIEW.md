Threads keep going after a bb restart.

## What you get

When the bb daemon on a machine restarts, or comes back having lost a running turn, bb stops
every thread that was working there with "Stopped — host daemon restarted" or "Stopped —
connection to host was lost". This plugin sends each such thread a short message so its agent
picks up where it was:

> bb restarted while you were working; your last turn was interrupted. Check where you were and
> continue.
>
> (auto-resumed after restart, 1 of 3)

bb resumes the agent's own session for that message, so the agent keeps its conversation.

## What it leaves alone

- Threads you or an agent stopped, threads that failed for any other reason, and threads that
  moved on since (a new message, a new turn).
- Interruptions older than 30 minutes.
- A thread that was waiting on you (a question, approval or permission) when it was cut: it
  waits for you.
- A child thread whose parent is resumed too: the parent hears that its child was interrupted
  and re-drives it, so the child gets no second nudge.
- A thread already resumed 3 times in a row without finishing a turn: it stays stopped until
  you step in. A turn that finishes resets the count.
- Each interruption gets one message, however many times the plugin looks.

## Settings

`enabled`, `windowMinutes` (30), `maxConsecutive` (3) and `message`, in Settings → Installed
plugins → Restart resume, or `bb plugin config restart-resume set <key> <value>`.
