Compose what feeds an agent. The Context composer page lists every artifact a thread's agent runs with (instruction
files, memory, skills, MCP servers, plugin tools, hooks, subagents, the system prompt and the conversation) with
token weights, as a list or a treemap.

## What you get

- **Keep or drop** each artifact, or a whole source at once, and add instruction text. Each change is labelled for
  the target provider: `enforced` (the host removes it), `advisory` (the agent is only told) or `none`.
- **Trajectory**: a side chat briefed with the composition and the thread's recent messages. Ask what this context
  will do to the thread, or describe the trajectory you want; apply its proposals with one click.
- **Spawn** a thread with the composition, on any provider and model, in the same workspace.
- **Save** compositions, and see which threads were started from which.
- **Copy for kb**: the composition as a kb outline, for kb's outline, graph and canvas views.
- **Compose context** in a thread's panel menu opens the page on that thread.
- `bb composer [thread-id]` prints the composition with its levers; `--kb` prints the kb outline.

## What is honoured

bb plugins can add instructions, tools and skills to a thread, not remove another's. So drops are advisory, except:

- Claude Code: whole groups, through env the plugin contributes to the thread (all CLAUDE.md files, auto memory,
  bundled skills, or everything Claude Code loads itself).
- pi: skills, tools and context files, when the composer's pi extension is installed.

Needs the Agent Artifacts plugin, which gathers the inventory.
