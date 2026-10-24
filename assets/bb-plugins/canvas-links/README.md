# bb-plugin-canvas-links

The bb panel of canvas-links: the tldraw offline canvases a thread, its project, or anyone linked, as a
thread side-panel tab. See [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

The links themselves belong to the `canvas-link` CLI
([modules/stacks/ai-agents/canvas-links](../../../modules/stacks/ai-agents/canvas-links)): it writes and merges the
log, resolves canvases through tldraw, and opens them. This plugin only runs it and draws the answer.

## Layout

| File | Role |
|---|---|
| `lib/canvases.ts` | The shape of `canvas-link ls --json`, parsed at the boundary, and a canvas as a row. Pure, tested. |
| `contract.ts` | The server ↔ host RPC contract: run `canvas-link ls\|add\|open`, read the hostname. |
| `host.ts` | Host entry: finds `canvas-link` (PATH, then Home Manager's profile) and runs it as the thread (`BB_THREAD_ID`) in its workspace. |
| `server.ts` | Resolves the thread's workspace machine and path, serves `list`, `linkFocused`, `open` over RPC; `open` runs on the machine that holds the canvas. |
| `app.tsx` | The `Canvases` `threadPanelAction` tab. Its tabs, rows, search and relative times are `../linked-items/`, shared with the kb plugin's kb canvases tab. |
| `tests/` | `npm test` (node:test over plain data). |

## Develop

```sh
npm install --include=dev
npm run typecheck && npm test
bb plugin build
bb plugin install .        # or: bb plugin reload canvas-links
```
