---
name: kb
description: Work in the person's kb (their knowledge base of nodes, fields and tags, with outline, graph and canvas views) through the kb_call, kb_screen and kb_manifest tools, either on the kb tab shown beside this thread or with no tab. Use when asked to look something up in kb, add or change nodes, arrange a canvas, or show the person something in kb.
---

# kb

Three tools reach the person's kb server.

- `kb_manifest` lists the actions, one line each: id, `read` or `write`, title, and `(in the tab: …)` for
  inputs the kb tab can fill. `kb_manifest {id}` shows one action whole, with its input schema.
- `kb_call {id, input}` invokes one. The answer is the action's output as JSON, then
  `filled from the person's tab: …` when the tab filled an input.
- `kb_screen` shows what the kb tab beside this thread shows (every open kb tab when there is none).

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
  to record by hand. Writes to a kb other than the person's (a repository's `.kb`, a Mac's own) are not
  listed there.
