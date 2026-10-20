---
name: agent-artifacts
description: Inspect what shapes this bb thread's agent — provider and model, instruction files (bb's AGENTS.md and the provider's own CLAUDE.md/AGENTS.md), skills from bb and from the provider with shadowing and collisions, plugin agent tools and plugin `bb` commands, and for Claude Code threads its MCP servers (with live connection status), hooks, permissions, subagents, slash commands, Claude plugins, output style and env. Use when asked which skills, instructions, tools, MCP servers or hooks are active here, why a skill or MCP server does not work, or what a thread runs with.
---

# Agent artifacts

`bb artifacts` prints the inventory of the calling thread as Markdown.

```sh
bb artifacts                 # counts per source, instruction files, tools, commands, problems
bb artifacts --full          # every skill and tool by name, with descriptions
bb artifacts --others        # also other providers' skills, for comparison
bb artifacts <thread-id>     # another thread
bb artifacts --no-claude     # skip Claude Code's own view (it starts a Claude Code process)
bb artifacts --json          # the whole inventory as JSON
```

Read it this way:

- **Injected by bb** skills reach every provider; **native** skills are the provider's own files.
- `shadowed`: a skill of the same name with higher precedence in the same tier replaces it
  (project over user over plugin).
- `collision`: two skills of one name in one bb source; bb drops both.
- `also in`: bb and the provider both define the name; both reach the agent.
- Plugin tools are declared by plugins; a plugin can still enable them per thread, so a declared
  tool is not proof it is offered here.

In a Claude Code thread the output ends with **Claude Code's own view** of the workspace: a Claude
Code session is started there with no prompt (no model call, hooks off, nothing saved) and asked
for its skills, subagents, commands, MCP server status and startup context; settings, plugin and
MCP config files are read from disk. It lists skills, subagents, slash commands, MCP servers,
hooks, Claude plugins, marketplaces, CLAUDE.md files, auto memory, output style, status line,
permissions and env vars (values masked), then **Needs attention** (failed MCP servers, servers
needing sign-in or approval). This view does not include what bb adds to the thread (bb skills,
the bb MCP bridge). For other providers, their MCP servers, hooks and permissions are not
visible yet.

The user can open the same view as a side-panel tab: the layers icon in the thread header, or
"Agent artifacts" in the side panel's new-tab actions.
