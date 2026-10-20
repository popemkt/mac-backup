# bb-plugin-agent-artifacts

The bb counterpart of the Claude Code `agent-artifacts` mod: what shapes a bb thread's agent, as a
thread side-panel tab, a header chip, and `bb artifacts`. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

## Layout

| File | Role |
|---|---|
| `lib/inventory.ts` | The inventory: types, skill precedence, plugin health, instruction candidates, Markdown. Pure, tested. |
| `lib/claude.ts` | Claude Code's own view: the 14 groups of the Claude Code `agent-artifacts` mod, built from a probe. Pure, tested. |
| `contract.ts` | The server ↔ host RPC contract (`probeClaude`). |
| `host.ts` | Host entry: starts Claude Code via the Agent SDK with a never-yielding prompt (no model call, hooks off, not persisted), asks for init, agents, MCP status, context usage; reads settings, `~/.claude.json`, plugin and MCP files. |
| `server.ts` | Reads bb through `bb.sdk` (thread, environment, providers, skills, plugins, context, files), caches 20 s (Claude probe 2 min, per workspace), serves RPC and `bb artifacts`. |
| `app.tsx` | The `threadPanelAction` tab and the `experimental_threadHeaderAction` chip. |
| `skills/agent-artifacts/` | Tells agents about `bb artifacts`. |
| `tests/` | `npm test` (node:test over plain data). |

## Develop

```sh
npm install --include=dev
npm run typecheck && npm test
bb plugin build
bb plugin install .        # or: bb plugin reload agent-artifacts
bb plugin dev              # rebuild and reload on save
```

## Precedence rules it applies

- bb skills (`provider: null`): plugin < bb user < bb project; two of one name in one bb source are
  both dropped (bb guide, agent-configuration).
- Provider-native skills: user < project, assumed by analogy; collisions there are not claimed.
- A name both bb and the provider define is marked `duplicate`: both reach the agent.
- Plugin tools are the declared capabilities of running plugins; a plugin may still enable them
  per thread through `bb.agents.configure`.
