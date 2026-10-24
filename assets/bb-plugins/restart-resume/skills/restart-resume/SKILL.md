---
name: restart-resume
description: What a message ending in "(auto-resumed after restart, n of m)" means, and how to turn the restart-resume plugin off or change it. Use when such a message arrives, or when asked why a thread continued by itself after bb restarted.
---

# Restart resume

The `restart-resume` plugin sent that message. Your previous turn was cut off because bb's daemon
on this machine restarted or lost the turn; bb kept your conversation, so nothing before the cut
is lost, but whatever was running at that moment (a command, a build, a tool call) stopped
part-way.

Continue by checking the state you left: re-read files you were editing, re-run the command that
was in flight if its result matters, then carry on with the task. Do not repeat work that
already landed.

The plugin resumes a thread at most `maxConsecutive` times (3) in a row without a completed turn,
only for interruptions newer than `windowMinutes` (30), and never for a thread someone stopped.

```sh
bb plugin config restart-resume set enabled false
bb plugin config restart-resume set message "<text>"
bb plugin logs restart-resume -n 20
```
