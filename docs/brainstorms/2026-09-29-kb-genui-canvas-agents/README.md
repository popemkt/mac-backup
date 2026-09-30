# kb: generative UI, a 2D/3D scriptable canvas, and agent surfaces

Research of 2026-09-29, with decisions taken with the owner on 2026-09-30.
This file is the canonical home of those decisions and of the build order.
The three reports hold the evidence, and this file does not restate them.

| Report | Question | Verdict |
|---|---|---|
| [generative-ui.md](generative-ui.md) | Which form of generative UI, and where to start | The model writes **view nodes** against kb's own view catalog. Code-writing comes last, sandboxed. |
| [canvas-2d-3d.md](canvas-2d-3d.md) | "tldraw, but ours", with 2D + 3D, an open format and scripts on the file | Nothing open does it, so kb builds its own. The storage shape is decided below (decision 6), not taken from the report. |
| [agent-native.md](agent-native.md) | Adopt Builder.io agent-native (multi-protocol actions, WebMCP, sidebar agent)? | **Copy the pattern, don't adopt the framework.** It requires Postgres (about 150 tables) and a second server stack. kb's action registry already does its core job. |

The raw notes behind the reports (per-product notes, the agent-native clone
and the spec copies) were in a session scratchpad and were not kept. The
URLs cited in each report are the durable trail.

## Decisions

1. **A view is a node.** The model is already designed in
   [plugin-composition §2–3](../../kb/waves/2026-09-24/briefs/plugin-composition.md):
   - a node that carries `sys.f.view` (a ref to a view option) is a view node,
     and its other props are that view's params;
   - a host names its views through `sys.f.views` (ref, multi);
   - placement is a field.

   This roadmap adds three things to that design:
   - every view type is in `ViewPoint`, including the outline modes, the graph
     renderers, canvas and later chart (that brief's "later" gap, pulled
     forward);
   - one of a host's views is marked default, like Notion's view tabs;
   - the frame's `sys.f.view.*` props migrate onto view nodes.
2. **`#graph-perspective` is folded into the view node.** Its `lens.query` is
   the subject, `lens.renderer` is the view type, and the other `lens.*`
   fields are that renderer's settings.
   - The sidebar's Graph item is a saved view with a default subject.
   - A "graphs" listing is a query over view nodes whose type is a graph
     renderer.
   - `.kb/views/*.json` becomes a projection of view nodes, or is deleted.
3. **Every action declares its mode**: `read`, or `write` with an optional
   `approval`. It is declared once on `ActionDefinition`. MCP, WebMCP
   (`readOnlyHint` / `consequentialHint`), the sidebar's approval prompts and
   script capabilities all read that one field.
4. **Generative UI has three modes, built in order.**
   - **A. Configure.** The model writes one view node. This is the daily
     value: the output is plain data and is edited like any other view.
   - **B. Compose.** A view whose children are views: dashboards, review
     pages. It is almost free once A exists.
   - **C. Code.** Model-written HTML/JS in a `#code-view` node, run
     sandboxed. It is the escape hatch, and the way the catalog grows: a code
     view that proves itself is promoted to a view type, and from then on A
     can use it.
5. **Scripts are mode C attached to a view, not a separate system.** A code
   view draws something. A script adds behaviour to an existing view: hover
   panels, auto-layout, "a sticky dropped in column X gets `status=doing`".
   - Both run through one sandbox with one capability API. That API can read
     the graph, write through actions (approval as declared in decision 3),
     draw temporary overlays, and subscribe to events.
   - The sandbox uses the MCP Apps iframe protocol, the same one that serves
     `ui://kb/view/*`.
   - There are two engines behind one shared contract suite: QuickJS-wasm for
     untrusted code and a Worker for trusted code.
   - Agent-written code is untrusted by default. Promotion to trusted is an
     explicit act, the same act that promotes a code view to a view type.
     Trust is per content digest, per machine, and kept as backup state,
     never committed.
6. **Canvas: meaning is nodes, geometry is view settings.**
   - A canvas is a view node of type `canvas`. Its settings are the layout:
     entries of node id plus transform (x, y, z, size, rotation, style),
     together with purely visual items such as freehand strokes, shapes and
     drawn arrows.
   - Anything with meaning (a sticky, a card, an idea) is a kb node. A new
     sticky is a node with no parent.
   - 2D and 3D are the same layout seen through a different camera.
   - **Canvas → node connections are derived, never saved alongside.** The
     loader turns layout entries into `:node/mentions` datoms, the same way
     `[[id]]` in text becomes a link. The layout is the only source, so it
     cannot drift from its index.
   - What each edit writes:
     - A drag that ends writes the layout once.
     - A text edit is a node update.
     - A new sticky creates the node first, then the layout entry. An orphan
       node is harmless, and an entry pointing at a missing node renders as
       "missing".
   - The layout stays in the node prop (`sys.f.canvas`) for now, which keeps
     writes atomic. If big layouts ever make `nodes.jsonl` noisy, the fix is
     a store-level sidecar for any large prop, not a canvas-only file format.
     This supersedes the todo `01KZGVK1B0DBJZYV7ETNYG4ERT`.
   - Edges keep the Logseq decision in `INSPIRATIONS.md`: a drawn arrow
     either binds a ref prop once, or is purely visual. There is no
     reconciler.
   - JSON Canvas 1.0 becomes import/export only.
7. **The agent knows what is on screen** (agent-native's `view-screen` /
   `navigate` pattern, see [agent-native.md](agent-native.md)).
   - The UI publishes temporary, per-tab screen state over `/ws`: route,
     focused node, selection, open view node and its query, canvas viewport
     and what is visible. It is never written to `nodes.jsonl`.
   - `ui.screen` (read) reads that state. `ui.navigate` and `ui.select` are
     commands that the UI carries out.
   - The sidebar attaches the screen state to every message. Because these
     are ordinary registry actions, an MCP client such as Claude Code sees
     the screen too.
   - Canvas presence and agent cursors travel on the same channel.
8. **Agent packages live outside core.**
   - Core owns only the generic pieces that every surface needs: the action
     mode, the screen-state channel and the WebMCP adapter.
   - The local Claude Agent SDK/ACP bridge, the sidebar UI and the prompting
     live in separate agent packages loaded through the plugin kernel. Core
     never imports them.
9. **MCP hosts get snapshots.** `ui://kb/view/<id>` renders data as of the
   call, with a refresh button. A live push needs a network path from the
   host to the local kb server, which remote hosts such as claude.ai don't
   have. In-app polling can be added later without a redesign.
   - `render_view` keeps a markdown fallback, because Claude Code does not
     render `ui://` (issue #95149).
10. **Charts come later, as a `chart` view type whose settings are a
    Vega-Lite spec.** A stored setting must be plain JSON, which Vega-Lite
    is. TanStack Charts (alpha 0.18) allows accessor functions, so its
    definitions can't always be saved as JSON.
    - It can become the renderer behind the same stored spec if it
      stabilises.
11. **A2A is deferred.** It is recorded as a gap until there is a real peer.
12. **Windowing is a layout view type, not a second system**
    ([research notes](https://docs.obsidian.md/Reference/TypeScript+API/WorkspaceLeaf):
    Obsidian leaves, Tana panels).
    - A layout view's children are view nodes, arranged as splits and tabs.
      A dashboard (mode B) is a layout view open inside one pane. A workspace
      is a layout view open as the whole screen. Only the chrome differs:
      panes can be dragged and docked, a dashboard is fixed.
    - A pane holds a ref to a view node, or to a node shown in its default
      view, plus ephemeral state (scroll, selection).
    - The live arrangement is per device, in local storage. "Save workspace"
      persists it as a layout node, which can be pinned and which agents can
      build.
    - Linked panes need no special mechanism. A pane's view whose focus is
      bound to another pane's focused node follows it; an empty `lens.focus`
      already means "the node I am shown for".
    - The URL names the focused pane. The screen state (decision 7) covers
      every pane, and `ui.navigate` can target one.
    - UI order: Tana-style panels first (Shift+Click opens to the right), then
      Obsidian-style splits and tabs on the same tree.
    - Library: dockview (MIT), behind an adapter, so that kb's layout tree
      stays canonical and the library's JSON is never stored.
    - Pop-out OS windows are a gap.

## Build order

Each step is its own commit or small series. A step marked *restructure*
changes no behaviour and is proven by the tests that already pass. The next
step then adds behaviour on top.

| # | Step | Kind | Unblocks |
|---|---|---|---|
| 0 | Action mode (`read`/`write`, `approval`) on `ActionDefinition`, published in the manifest. A contract property: every surface lists the same actions and returns the same receipt. | restructure + add | 4, 5, 9 |
| 1 | **View types:** every `ViewPoint` entry declares a settings schema. Fold the outline `ViewMode` list and `GRAPH_RENDERERS` into `ViewPoint` (closes gap `01M3EZRFJ9RYFJJ4MW322RQ28S`). | restructure | 2 |
| 2 | **View nodes** per plugin-composition A1 (`sys.f.view`, `sys.f.views`, placement), plus a default view per host. Migrate the frames' `sys.f.view.*` and the `#graph-perspective` nodes. Many views per node, one default. Sidebar Graph becomes a saved view. Resolve `.kb/views/*.json`. | restructure | 3, 6, 7 |
| 3 | **Mode A:** `view.propose` (validating), the view catalog with schemas in `kb_manifest`, `render_view` by view id with a markdown fallback, and `ui://` snapshots with the MCP Apps mime type. | add | 6 |
| 4 | **WebMCP adapter** over `/api/action`, behind feature detection (the polyfill is optional). | add | — |
| 5 | **Screen state:** the `/ws` screen channel plus `ui.screen`, `ui.navigate` and `ui.select`, then the **agent packages**: a local Claude bridge and the sidebar plugin. | add | — |
| 6 | **Layout view type** (decision 12): mode B dashboards plus panes: Tana-style panels, then splits and tabs (dockview behind an adapter), and saved workspaces as nodes. | add | — |
| 7 | **Canvas as a view:** canvas becomes a `ViewPoint` view type, text items become nodes, mentions are derived at load, and JSON Canvas becomes import/export. Then finer-grained canvas actions, `canvas.describe`, and lints that return `{new, resolved}`. | restructure, then add | 8 |
| 8 | **Canvas 3D:** z and 3D transforms, and a perspective camera on the existing three.js WebGPU scene kit (three r180 → r186). | add | — |
| 9 | **Sandbox:** one capability API and the MCP Apps iframe bridge, with QuickJS (untrusted) and Worker (trusted) engines under one contract suite. Then `#code-view` (mode C), then `#script` attached to views, then promotion. | add | — |
| 10 | **Chart view** (Vega-Lite). | add | — |

**Deferred by the owner (2026-09-30):** step 7. Canvas items stay in the
JSON Canvas layout for now, and turning them into nodes waits. Step 8 (3D)
builds on the current JSON Canvas doc, putting z and 3D transforms in extra
node fields that already survive a round-trip.

Steps 1–2 are the load-bearing restructure and the largest single piece.
After step 2 there are three independent lines: 3→6, 4→5, and 7→8. Step 9
needs 0 and 3.
