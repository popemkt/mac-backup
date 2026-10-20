See what shapes each thread's agent, in one place beside the conversation.

## What you get

- A **layers chip** in the thread header with a count of what reaches the agent (a dot when a plugin
  is failing). Click it to open the **Agent artifacts** side-panel tab.
- The tab shows the provider, model, reasoning and permission mode, the workspace and branch, and
  context usage (with the provider's breakdown when it reports one), then:
  - **Instruction files and hooks**: bb's `AGENTS.md` files and the provider's own `CLAUDE.md` /
    `AGENTS.md`, plus `.bb-env-setup.sh` / teardown hooks, each opening in bb's preview.
  - **Skills**, split into those bb injects for every provider and the provider's native ones,
    grouped by source, with `shadowed`, `collision` and `duplicate` marked. Other providers'
    skills can be shown for comparison.
  - **Plugin tools**, **plugin `bb` commands** and **plugins** with their health, services and
    what each adds.
  - For Claude Code threads, **Claude Code's own view** of the workspace, as the Claude Code
    `agent-artifacts` mod shows it: skills, subagents, slash commands, MCP servers with live status
    and their tools, hooks, Claude plugins, marketplaces, CLAUDE.md files, auto memory, output
    style, status line, permissions and env vars (masked until revealed), with failing MCP servers
    called out. It comes from a Claude Code session started in the workspace with no prompt.
- One filter box over all of it (`/` focuses it), tabs per kind, and Copy as Markdown.
- `bb artifacts` prints the same inventory for terminals and agents.

## How it reads Claude Code

On the workspace's machine, the plugin's host entry starts Claude Code through the official Claude
Agent SDK with a prompt that never arrives: no turn runs and no model is called. Hooks are off for
that session and nothing is saved to its history. Its MCP servers do start, so their status is
real; the answer is kept for two minutes. Settings, plugin and MCP files are read from disk.

## What it cannot see

Other providers' MCP servers, hooks and permissions (Codex is next).

Read-only: the plugin writes nothing and calls no model.
