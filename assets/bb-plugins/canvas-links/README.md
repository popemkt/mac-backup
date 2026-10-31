# bb-plugin-canvas-links

The bb panel of canvas-links: the tldraw offline canvases a thread, its project, or anyone linked, as a
thread side-panel tab. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

The links themselves belong to the `canvas-link` CLI
([modules/stacks/ai-agents/canvas-links](../../../modules/stacks/ai-agents/canvas-links)): it writes and merges the
log, resolves canvases through tldraw, and opens them. This plugin only runs it and draws the answer.

## Layout

| File | Role |
|---|---|
| `lib/canvases.ts` | The shape of `canvas-link ls --json` (and `ls --available`), parsed at the boundary, a canvas as a row, the machine a key names. Pure, tested. |
| `contract.ts` | The server ↔ host RPC contract: run `canvas-link ls\|add\|rm\|open\|help`, read the hostname. |
| `host.ts` | Host entry: finds `canvas-link` (PATH, then Home Manager's profile) and runs it as the thread (`BB_THREAD_ID`) in its workspace. |
| `server.ts` | Resolves the thread's workspace machine and path, serves `list`, `available`, `link`, `unlink`, `open` over RPC, each action on the selected canvases' keys; `open` runs on the machine that holds the canvas. A machine whose `canvas-link` predates keys (its `help` has no `--available`) is driven the old way: Link and Unlink pass the bare id or path on the canvas's own machine, and search covers linked canvases only. |
| `app.tsx` | The `Canvases` `threadPanelAction` tab: the RPC as a data source for `../linked-items/panel.tsx`, the panel itself (tabs, search, selection, actions, rows), shared with the kb plugin's kb canvases tab. |
| `tests/` | `npm test` (node:test over plain data), with `../linked-items/tests/`. |

## Develop

```sh
npm install --include=dev
npm run typecheck && npm test
bb plugin build
bb plugin install .        # or: bb plugin reload canvas-links
```
