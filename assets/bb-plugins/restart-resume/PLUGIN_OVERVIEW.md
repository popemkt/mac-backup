Threads keep going after a bb restart, and every thread says why its last turn stopped.

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

## Why it stopped

A thread whose last turn was cut off shows it, in its sidebar row and as a small pill in its
header, until a later turn completes:

- **Stopped**: you or an agent stopped it (bb does not record which).
- **Daemon restart → resumed 1/3**: bb's daemon restarted and this plugin continued the thread,
  the first of at most 3 times in a row. Or "→ waiting on you", "→ cap reached", "→ parent
  resumes" when it held back.
- **Connection lost → …**: the machine's connection dropped and its daemon came back without the
  turn.
- **Host removed**, **Turn idle**: bb stopped it because the machine went away, or the agent's turn
  went idle.

Hover the pill for the reason, who, when and the auto-resume state; click it to see them in a
toast.

## Settings

`enabled`, `windowMinutes` (30), `maxConsecutive` (3) and `message`, in Settings → Installed
plugins → Restart resume, or `bb plugin config restart-resume set <key> <value>`.
