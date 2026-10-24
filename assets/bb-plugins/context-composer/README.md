# bb-plugin-context-composer

See everything that feeds a bb thread's agent, compose it (keep, drop, add), ask a side chat what the composition
does to the thread's trajectory, and start a thread with it. Every change says how far the host honours it:
`enforced`, `advisory` or `none`. Design and spike results:
[docs/research/2026-10-25-context-composer-v1.md](../../../docs/research/2026-10-25-context-composer-v1.md).

## Layout: a pure core, thin adapters

| Path | Role |
|---|---|
| `core/model.ts` | The composition model: sources, artifacts, token weights, the manifest of decisions, diff, totals. |
| `core/targets.ts` | Compile targets (bb Claude Code, bb Codex, bb pi, other bb providers, the claude and codex CLIs): each lever and its enforcement; `compile()` turns a manifest into env, args and instruction text. |
| `core/trajectory.ts` | The trajectory side chat's brief and its `composer-proposal` blocks, parsed and applied. |
| `core/views.ts` | View models: the weight tree and a squarified treemap. |
| `core/kb.ts` | The composition as a kb outline (Tana Paste) plus the schema commands, so kb's views render it. |
| `core/text.ts` | Markdown for `bb composer`. |
| `adapter/inventory.ts` | bb adapter in: agent-artifacts' inventory (and Claude Code's own view) mapped to a composition. |
| `adapter/records.ts` | bb adapter: what the plugin keeps on a thread it starts (plugin metadata), parsed defensively. |
| `server.ts` | bb adapter: RPC, SQLite manifests, spawn, the advisor thread, `agents.configure`, contributed env, `bb composer`. |
| `app.tsx`, `views/` | bb adapter out: the Context composer page (a nav panel), the thread-panel shortcut, the list and treemap views. |
| `pi/extension.ts` | pi adapter, first slice (experimental): enforces a compiled manifest inside pi and reports what pi sends. |

`core/` imports nothing outside itself (a test enforces it). The bb adapter reads the inventory only through the
agent-artifacts plugin's RPC, so there is one inventory reader.

## Develop

```sh
npm install --include=dev
npm run typecheck && npm test
bb plugin build
bb-plugins-sync --path .   # try it on a bb server
```
