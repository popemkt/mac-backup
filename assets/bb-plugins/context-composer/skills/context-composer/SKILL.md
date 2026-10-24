---
name: context-composer
description: Show and compose what feeds this bb thread's agent — instruction files, memory, skills, MCP servers, plugin tools, hooks, subagents — with token weights, and what removing each would do on a provider (enforced by the host, advisory, or impossible). Use when asked what is in this agent's context, what is heavy in it, what could be dropped for a task, or how to start a leaner thread.
---

# Context composer

`bb composer` prints the calling thread's composed context.

```sh
bb composer                        # artifacts by kind, heaviest first, with token weights and removal levers
bb composer <thread-id>            # another thread
bb composer --target cli:claude-code   # levers for another target: bb:claude-code, bb:codex, bb:pi, bb:other, cli:codex
bb composer --kb                   # a kb outline (Tana Paste) and the kb schema commands
bb composer --json                 # the composition as JSON
```

Read the lever this way:

- `enforced`: the host removes it when a thread is started from a composition (Claude Code env switches cover whole
  groups only, for example every CLAUDE.md at once).
- `advisory`: it stays loaded; the agent is only told not to use it.
- `none`: the provider's own prompt and tools, or the conversation (a fresh thread drops it; a fork keeps it).
- `~` before a weight means estimated from size; `on demand` means it loads only when used (MCP tools behind tool search).

The person composes and spawns from the Context composer page in bb; agents only read.
