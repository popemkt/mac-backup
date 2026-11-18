---
name: kb
description: Work in the person's kb (their knowledge base of nodes, fields and tags, with outline, graph and canvas views) through the kb_call, kb_screen and kb_manifest tools, either on the kb tab shown beside this thread or with no tab. Use when asked to look something up in kb, add or change nodes, arrange a canvas, or show the person something in kb.
---

# kb

Three tools reach the person's kb stores. Each takes an optional `kb`: the store's name.

- `kb_manifest` first lists the configured stores (`kb stores …: kb-popemkt (default, in the tab), kb-work`),
  then the actions, one line each: id, `read` or `write`, title, and `(in the tab: …)` for inputs the kb tab
  can fill. `kb_manifest {id}` shows one action whole, with its input schema.
- `kb_call {id, input}` invokes one. The answer is the action's output as JSON, then
  `filled from the person's tab: …` when the tab filled an input.
- `kb_screen` shows what the kb tab beside this thread shows (every open kb tab when there is none).

## Which store

- Leave `kb` out to use the store the kb tab beside this thread shows, or the default store when no tab is
  open. That is usually right: "this node" is in the tab's store.
- Pass `kb: "<name>"` when the person names another store ("in my work kb"), or when what you need lives
  there. A call to a store other than the tab's is made in no tab: pass every input.
- An unknown name fails with the list of configured names. Say which store you wrote to when it is not the
  default.
## With the kb tab open (hands-on)

The panel beside the thread is a kb tab, and every call is made in it while the person shows this thread. When
they switch to another thread, this thread's kb tab stays loaded but hidden, and is not your tab: calls are
made in no tab (below) until they come back to this thread.

- Leave out an input the listing marks as filled in the tab, to mean what the person is looking at:
  `kb_call {id: "node.update", input: {text: "New title"}}` renames the node they focus; the canvas verbs act
  on the open canvas, and `arrange`, `group`, `ungroup` on its selected items. Read the `filled from` line to
  learn which node or canvas that was, and say so.
- Show results: `ui.navigate {node: "<id>"}` or `{route: "/graph"}` moves that tab; `ui.select` sets its
  selection or focus.
- If a call is refused with "… is required; pass it, or have … in the session's tab", the person is not looking
  at one: ask, or pass the input.

## With no kb tab open (get the work done)

Calls are made in no tab: pass every input, and nothing on the person's screen changes unless you call
`ui.*`. The person can open the tab from the thread header's network button.

## Notes

- Writes are real and immediate; `node.delete` deletes. Read with `node.get`, `graph.search` or
  `graph.query` before changing what you have not seen.
- Answers are cut at 40,000 characters; narrow the call (a smaller `depth`, a more specific query) when cut.
- Canvases you create or edit link themselves to this thread (the person's **kb canvases** tab lists them):
  every `kb_call` write, and your own `kb` CLI or kb MCP writes, carry this thread's label (`KB_VIA`). Nothing
  to record by hand. Writes to a kb the plugin is not configured with (a repository's `.kb`) are not listed
  there.
