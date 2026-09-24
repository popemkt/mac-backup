# `kb ui` — browser outliner + subscription backend (design doc)

Tana-style outliner UI for kb, served locally by `kb ui`, opened in the
browser. Client-side DataScript for instant interaction; a **subscription
layer that lives in the backend** so other apps (not just this UI) can
subscribe to live queries later. MCP Apps generative UI is phase 2.

## Decisions (from Q&A)

| Decision | Choice |
|---|---|
| Shell | Browser app served by `kb ui` (no Electron/Tauri). **Why not Electron for "local ops like materialization":** those ops run in the `kb ui` bun server, which has full fs access — the browser only calls actions. Electron's sole trick is bundling Chromium+Node to get fs in one process; we already have a local server process. Zero gain, +200MB. |
| Frontend build | **Vite+ (`vite-plus@0.2.8`, on npm, Evan You et al — confirmed installable)** + React 19 + Tailwind 4 + Zustand — same stack as nxus, so its outliner forks in cleanly. If vp misbehaves anywhere, its config is Vite config; plain-Vite fallback is a dependency swap. |
| Bun's role | Runtime for the server only (`kb ui` = Bun.serve listen + WS upgrade + `Bun.file` bodies). HTTP routing, asset/static reads, SubscriptionHub message/broadcast/cleanup, and fs-watch reloads are Effect v4 programs (`@effect/platform-bun` FileSystem). **Not** `@effect/platform-bun` `BunHttpServer` as the outer server: on effect@4.0.0-beta.106 its `HttpServerRequest.upgrade` path deadlocks on the request fiber when awaiting the open deferred / forking `socket.runRaw` from that fiber (empirically verified). Protocol-preserving Bun.serve WS + Effect hub is the working single boundary. Bun ≠ bundler here; Vite builds the frontend. No Effect in the browser bundle. |
| Reactivity | Client-side DataScript (Logseq architecture) **plus** backend subscription hub designed for third-party consumers |
| Edit scope v1 | Solid basics (outline CRUD, props/tags panel, [[ref]] autocomplete, query page, backlinks) |
| MCP Apps | **Backbone now, apps later**: shared render layer (query + template → HTML) ships in this wave and kb MCP serves one `ui://` resource through it. Adding an "app" later = adding a template + query, nothing structural. |

## Why bun *and* vite (your question)

The backend must be bun — kb's store/query/registry code is bun TS, and
`kb ui` is just another surface over the same registry. The frontend is a
normal web app; Vite is its dev server + bundler. They compose:
`kb ui --dev` proxies to Vite HMR; production `kb ui` serves `ui/dist/`
static files. Vite+ ("vp") is a superset CLI — if you install it later the
config carries over unchanged.

## Architecture

```
browser ──HTTP GET /api/graph────────► kb ui server (bun)
   │  ◄──full node set (jsonl parse)──   │
   │                                     ├─ registry.invoke (same actions as CLI/MCP)
   │ ──POST /api/action {id,input}─────► ├─ JsonlStore commit
   │  ◄──receipt───────────────────────  ├─ fs.watch .kb/nodes.jsonl
   │                                     └─ SubscriptionHub
   │ ◄──WS: tx events / query rows ─────────┘
DataScript (client) ← re-run open queries on tx
```

Server ownership lives behind the stable facade `packages/app/server/src/index.ts`, which
re-exports the public CLI/server seam (`startUi`, `runUiCli`, …). The
implementation modules under `packages/app/server/src/` split by concern:

| Module | Owns |
|---|---|
| `server.ts` | Bun.serve / Effect runtime boundary, fs-watch, CLI entry, Scope shutdown |
| `http.ts` | Effect REST/API routing, failure mapping, kb asset GET, SPA static fallback |
| `session.ts` | Effect `SubscriptionHub` (clients, message processing, broadcast, cleanup) |
| `assets.ts` | Effect SPA `ui/dist` static + `.kb/assets` serving (`Bun.file` body at boundary) |
| `saved-queries.ts` | Effect list/materialize `.kb/queries/*.edn` |
| `paths.ts` | `KB_PKG_ROOT`, `UI_DIST` |

- **Client DataScript**: browser loads all nodes once, builds the same datom
  set the CLI builds (shared `foundation/query` code — it's isomorphic TS, no
  node APIs in the datom builder). Keystrokes never wait on the network.
- **Mutations**: `session/runtime.ts` invokes isomorphic actions against the
  browser's `BrowserStore` and existing DataScript index first, then sends the
  same invocation through one ordered `POST /api/action` push lane. Port-only
  actions remain server-owned. A failed confirmation asks the live socket to
  reconcile from the current revision; only `snapshot-required` escalates to
  an authoritative `/api/graph` refresh. Cold-boot `loadGraph` may fall back to
  fixtures; `hydrateFromWire` is boot-only — live resync uses
  `refreshFromWire` so `loadSource` stays `api`. No temp-id dance (nxus's
  pain): client mints final ULIDs, server accepts explicit ids (already
  supported by `node.add`).
- **Change flow**: server fs-watches `.kb/` (catches CLI/MCP/agent writes
  too) → reloads nodes → rebuilds a DataScript database → broadcasts node-level
  deltas on WS → the client applies deltas → open queries re-run.

## SubscriptionHub — the "other apps can subscribe" layer

Designed as a backend service now, minimal v1, clear growth path:

```
WS protocol (JSON):
→ {op:"subscribe",   id:"s1", query:"[:find ?id ... ]"}   // EDN datalog
→ {op:"unsubscribe", id:"s1"}
← {op:"rows",  id:"s1", rows:[...], rev:N}   // full rows on change (v1)
← {op:"delta", id:"s1", ...}                  // future: diffed rows
← {op:"tx",    datoms:[...], rev:N}           // broadcast to graph subscribers
```

- v1 implementation: on every load, the server rebuilds a DataScript database
  from the current nodes; on fs change it re-runs each subscription's query and
  pushes rows if the result hash changed. Coarse but correct; 50k nodes re-query
  in ~20ms, fine for tens of subscriptions.
- The browser UI is just subscriber #0 (it mostly uses `tx` events + local
  re-run; thin clients use `rows` subscriptions and need no DataScript).
- Growth path kept open, not built: result diffing, per-query dependency
  tracking (nxus has a reference impl), auth token if ever exposed beyond
  localhost. Server binds 127.0.0.1 only.

## Fork from nxus (verdict: fork the tree, ignore the plumbing)

nxus's outliner is genuinely portable — components import only a classname
helper; the tree algebra is a pure store over `Map<id,node>`; all data
coupling sits in two seam files we replace with kb calls.

Taking:
- `outline.store.ts` (419 LOC + tests) — indent/outdent/move/fractional
  order/visible-node flattening. Adapt node shape to kb (`children` array
  instead of fractional order props — simpler, kb owns order).
- `node-block.tsx`, `node-content.tsx`, `bullet.tsx` — recursive row,
  contentEditable + cursor/IME handling, keyboard map (Enter/Tab/merge).
- `field-value.tsx`, `fields-section.tsx` — per-type inline prop editors.
- `docs/outline-editor-prd.md` — feature checklist to track against.

Not taking: SQLite/Drizzle spine, server-fn sync hook (temp-id swap dance),
event-bus/dependency-tracker (DataScript tx listener replaces it), TanStack
Start/Router (we need one page + panels, not an app framework).

Known nxus gaps we must add ourselves: `[[ref]]` autocomplete, backlinks
pane, persistent collapse state (localStorage), query page.

## v1 feature list

- Outline: expand/collapse (persisted), zoom/breadcrumbs, add/edit/delete,
  indent/outdent, keyboard reorder; Enter/Tab/Shift-Tab/Backspace-merge.
- Node: props panel (typed editors, add/remove field values), tag chips,
  `[[` autocomplete inserting refs, backlinks pane.
- Query page: datalog textarea + run, saved queries (`.kb/queries/*.edn`)
  listed and runnable, results as table with node links.
- Search box (text substring) with jump-to-node.
- Live updates: edits from CLI/agents appear without reload (fs-watch → WS).
- ~~No drag-drop, no undo/redo, no table/board views in v1 (explicitly out).~~
  **Superseded.** Table/Board/Cards views shipped with the refinement wave,
  outline and canvas both have undo/redo, and board cards drag between groups.
  Outline row drag-and-drop is still not implemented (keyboard reorder only).
  See [Interaction model](#interaction-model-as-shipped-2026-08-23-wave).

## Interaction model (as shipped, 2026-08-23 wave)

The v1 list above is the original contract. Implementation waves rebuilt
the interaction layer on top of it — i1 (editor), i2 (graph), i3 (canvas),
i5 (cross-surface polish), i6 (ontology), i12 (contextual references). The
normative specs are
`docs/kb/waves/2026-08-23/reports/r1-editor.md`, `r2-graph.md`, `r3-canvas.md`,
`r7-ux-sweep.md` and `r5-ontology.md`; each carries its own implementation
handoff with the honest cut list.

### Transient-prune remote compensation

When an empty session-transient is pruned after its optimistic `node.add` has
already reached the server, the mutation path MUST post a compensating delete.
Pre-existing nodes remain ineligible for this cleanup.

### Outline editor (i1)

**Transient nodes replace ghost rows.** There is no permanent phantom bullet at
the end of a list: `GhostNodeRow`, with its async character buffering and
`beforeinput` interception, is deleted outright. Tana semantics instead —
`mutations.createTransientNode` mints a *real* node synchronously through the
normal optimistic path, records it in `outlineStore.transientIds`, and activates
it at offset 0. The click-to-create affordance is a whitespace strip
(`data-create-child-zone`) rendered at the end of every expanded container and
at zoom-root level. `pruneOutgoingTransient` silently drops a session-transient
node when focus leaves it while it is still empty; a node that existed before
this session is never pruned, so committed content cannot evaporate.

**Two keymaps, one row.** The authoritative tables are r1-editor.md §3.2; the
split is what matters here:

| Mode | When | Owner |
|---|---|---|
| **A — active edit** (caret inside node text) | typing | `components/outline/use-node-keydown.ts` |
| **B — selection** (row selected, caret inactive) | after `Escape`, or arrow-nav | `lib/selection-keymap.ts` + `components/outline/use-selection-keymap.ts` |

Mode A owns split/merge/indent/outdent, soft line break (`Shift+Enter`),
vertical caret motion, and autocomplete interception. Mode B owns
`ArrowLeft/Right` collapse-expand-parent-firstchild, `o` / `Shift+O`
create-below/above, `Space` toggle, `Cmd+.` zoom, and printable-character
re-entry into Mode A. Focus hand-offs are specified per operation (split → new
node at 0; indent/outdent → same offset; merge → the join boundary; delete →
neighbour) and tested.

**Caret geometry is measured, not guessed.** `lib/caret.ts`
exposes `readCaretGeometry` (range rects → real line detection),
`verticalArrowDecision` (pure: is this arrow a line move or a row move?) and
`nearestOffsetForX` (column restoration), fed by `outlineStore.focusX`. Offsets
into the *serialized markdown* — not the DOM text — come from
`lib/md-edit.ts` (`getCaretSerializedOffset` / `setCaretSerializedOffset`), a
recursive measure that survives element boundaries and counts an atomic ref
pill at its full token length. A layout-free environment (unit tests, headless)
degrades to offset-based behaviour rather than breaking. `focusSeq` forces
caret re-placement when a row remounts.

**Undo/redo is action-level, not keystroke-level.** `actions/mutations.ts`
`restoreInvocations` compares the graph states before and after a plan and
derives compensating shared-action invocations. `outlineStore` keeps bounded
`undoStack` / `redoStack` of `{ undo, redo }` (`HISTORY_LIMIT` = 50).
`Cmd/Ctrl+Z` binds outside editable targets, and in api mode compensation uses
the same local invocation + ordered push lane — there is **no** server-authoritative
undo journal, and rapid same-node text edits are not coalesced. Structural
operations (split, merge, indent, outdent, delete, move) are the covered case.

**Refs are atomic in the editor.** An active editor renders `[[id|label]]` as a
`contenteditable=false` pill carrying its serialized token, so a raw ULID never
faces the caret and serialization round-trips canonical markdown.

**`sys.*` rows are read-only at the door.** `store.activateNode` degrades a
`sys.*` id to selection so no caret ever enters one; the row shows a hover
padlock instead of failing on write.

### Contextual references (2026-08-27)

Tana's *contextual content*, expressed with no new storage shape and no new
widget: a **contextual reference is an ordinary node** carrying its target on
the `sys.f.ref.target` ref field. The field is the whole declaration — no tag —
because a node with no target is not a reference (DESIGN.md → [Kinds, roles and
options](./DESIGN.md#kinds-roles-and-options)). Same anatomy as a query node
(`sys.f.query`), so children, tags, fields, collapse state, instance keys, both
keymaps, undo and the transient rules are the ordinary ones — nothing in
`visible-instances.ts`, `instance-key.ts` or `frame-rows.ts` changed to
accommodate it.

`packages/app/ui/src/lib/contextual-ref.ts` owns the three rules that make it read as a
reference:

- **Display is the target's text, verbatim.** `rowText(node, nodes)` returns
  `node.text` for an ordinary row and the *target's* text for a reference, so the
  row renders through the same inline-markdown path as every other row: bold,
  code, inline refs and `assets/` media all render as content. Returning a
  `[[targetId|label]]` token instead was tried and rejected after looking at the
  rendered page — a ref label is terminal in the inline grammar, so `**bold**`
  showed up literally and the entire row went link-coloured. A missing target
  renders as the `[[id]]` token, the way every other dangling ref renders, never
  a blank row and never a throw. `ReferencesSection` calls the same function, so
  a referrer whose own text is empty is not a blank line in a backlinks list.
  What a ref *prop* buys over a hand-typed `[[id|label]]`: the hand-typed label
  freezes at insert time, this resolves every render.
- **The row's own text is read-only, and the click is answered at the target.**
  The text is not what the row owns, so a caret in it would edit an invisible
  second string. `rowTextReadOnlyReason(id, node)` is the single owner of that
  rule — it absorbed the `sys.*` read-only check (r1 D20), which was previously
  duplicated between `outlineStore.activateNode` and `NodeContent`, and it
  supplies the padlock's wording. Rather than leaving the click dead, `NodeBlock`
  routes the same activate intent to the node that owns the string: clicking a
  reference opens the original. ⌘-click on the bullet still zooms the reference
  itself, so the two destinations have two affordances.
  **Deliberate deviation from Tana**, which edits the original *in place* through
  the reference: redirecting the editor's write to a node other than the row's
  `data-node-id` forks the one row↔node identity that instance keys, both
  keymaps, optimistic mutations and undo are all built on.
- **The bullet reuses the existing reference treatment** (dashed ring). Only the
  bullet: `NodeBlock`'s `isRef` *prop* still means "this row renders a node
  whose home is elsewhere" and keeps suppressing nested query results and the
  create-child strip, because a contextual reference's children **are** its own
  and creating them is the whole point. `bulletIsRef = isRef || isContextualRef(node)`.

**Contextual children belong to the location, not the target** — the
Tana-faithful default, and the one question the owner did not answer. Visiting
the original shows only its own children; the contextual ones surface there
through References/backlinks (which see the reference because `:node/mentions`
counts ref props — see [DESIGN.md → Refs](./DESIGN.md#data-model--everything-is-a-node)).
To change the default, the union goes in exactly one place:
`frameListChildren` / `frameRows` in `packages/app/ui/src/lib/frame-rows.ts`, the declared
single owner of "which rows does this frame show".

**Creation** is a node-⌘K step, next to *Turn into query*: **Turn into
reference…** opens the picker, which is the same picker `Add tag` and `Add field`
use — generalized from two kinds to three, with the candidate *source* as the
only difference. A reference's candidates come from `fuzzyNodeCandidates`, the
resolver the `[[` autocomplete and the typed ref field editor already share, so
no fourth node picker was added. The gesture itself is `mutations.addTag` +
`mutations.updateProp`, i.e. plain `node.update` — no new registry action, and
the CLI/MCP form is in DESIGN.md.

**Named gaps.** The target is repointable only with debug fields on for that row
(node ⌘K → *Show debug fields*), because `sys.f.*` props are hidden from field
rows by default — the identical
limitation `#query`'s EDN prop has, deliberately not widened here. The
References list shows a reference by its rendered target text rather than by the
ancestor context it sits in, so on the original's own page a reference row reads
as a copy of the original's text; a context breadcrumb (and rendering the
contextual children inline under the backlink row) is the obvious next step and
is not built. There is no global ⌘K entry: a contextual reference needs both a
host row and a target, and the global palette has no two-step for that.

### Ontology scope (i6)

The reading-mode consumption of the resolver documented in
[DESIGN.md → Ontologies](./DESIGN.md#ontologies--a-lens-over-the-graph).

**Scope lives in the URL**, so it is linkable, survives reload, and the back
button exits it: `/o` (list), `/o/<id>` (members page), `/o/<id>/outline`,
`/o/<id>/graph` (`lib/router.ts`, `ontologyPath()`).

**Scope is a projection, not a sandbox.** `outlineStore` gained `ontologyId`,
`ontologyMembers`, `ontologyWarnings`, `preScopeRootId` and `setOntologyScope`,
and every wire→outline conversion goes through a single `projectWire()` helper
so there is one place where members are filtered. Crucially `queryDb` stays
built over the **full** snapshot — backlinks, `#query` nodes and WS
subscriptions keep honest reach while the outline, search, keyboard navigation
and breadcrumbs see members only. Membership is memoized in a `WeakMap` keyed
on the wire-snapshot array (inner key `rev` + ontology id), which is exact
under optimistic local edits where `rev` does not move.

**Scope never dead-ends.** Navigating to a non-member leaves the scope with a
toast rather than silently doing nothing, and the scope chip
(`⬡ Name · N members · Members/Outline/Graph · Exit`) always offers the exit.
Members whose real parent is a non-member hang off the ontology node itself, so
displayed depth inside a scope is *synthetic* — structural editing
(Tab/Shift-Tab/move) still operates on the real graph. That mismatch is a named
follow-up, not a fixed contract.

**Graph under scope** is one additive `restrictTo?: Set<string>` on
`ExtractLensOptions`, intersected in `resolveNodeSet`; internal-edges-only falls
out of the existing endpoint check. Ontology and perspective are orthogonal —
the ontology picks *which nodes*, the perspective picks renderer/color-by/
cluster-by — and both pickers sit in the graph header.

Elsewhere: an **Ontologies** sidebar section, the `⬡` bullet kind, three
`sys.command` palette entries (new / enter / exit). The ⌘K palette stays
**global** on purpose — it is the escape hatch out of a scope.

### Graph (i2)

The graph is the CodeFlow-parity surface: every renderer is
`datalog query → {nodes, edges} → renderer`, and interaction happens *in place*
rather than by navigation.

- **Select-in-place.** A single click selects: the neighbourhood stays lit,
  non-neighbours dim to ~15% alpha, and an info card (label, tags, degree,
  Open/Focus) appears. Background click and `Escape` clear. Double-click,
  `Enter`, ⌘/Ctrl-click and the card's Open button all navigate to the outline.
  Hover does the same lighting through `nodeReducer`/`edgeReducer` only — hover
  and selection never mutate graph data.
- **Animated camera.** `graph-camera.ts` owns `fitView`, `zoomIn`, `zoomOut`,
  `resetCamera`, `focusNode` — cubic-eased ~300ms. Toolbar buttons plus
  `+`/`=`, `−`, `0`, `f`, `/`. Camera state survives data updates and theme
  switches, and a module-level positions cache keyed by layout restores a
  perspective's layout when you return to it.
- **Worker layout.** `fa2-layout.ts` runs ForceAtlas2 in a web worker with a
  2.5s auto-settle (`SETTLE_TIMEOUT_MS`), falling back to a synchronous
  rAF-chunked loop by feature detection. Dragging a node reheats the layout
  (~600ms burst) on release; the camera is disabled during drag so a pan
  cannot fight the drag.
- **Search and filter compose.** The toolbar search (`/` focuses) does
  case-insensitive substring matching on labels, `Enter` cycles matches with an
  animated camera move; the collapsible tag legend isolates a colour bucket on
  click. The two intersect — a node must pass both to stay lit. Both are
  **ephemeral**: filters, search and selection never persist, while a renderer
  switch is a persisted prop write (`mutations.setLensRenderer`).
- **Directed, weighted edges.** `EdgeArrowProgram` is enabled and edges render
  as arrows. `graph-lens.ts` deduplicates parallel edges into a `weight` count,
  and stroke width scales as `√weight` — repeated relationships read as
  thicker, single links stay hairline.
- **Honest empty and large states.** Zero matches renders guidance rather than
  a blank canvas; invalid EDN surfaces an amber warning chip (`queryError` on
  the lens); a capped lens reports "top N of M nodes by degree" in the header's
  node count, beside an "edit max-nodes" jump to the perspective node, so the
  report stays in flow and never covers canvas chrome. Above
  `LARGE_GRAPH_THRESHOLD` = 1500 nodes the renderer degrades deliberately:
  `hideEdgesOnMove`, label threshold 12 (from 7), label density 0.5 (from 0.8).
- Cluster renderer: padded hulls with member-count labels, top-15 cluster cap,
  drag with live hull redraw, hull-click isolation. Tree renderer: pointer
  pan/zoom plus Fit / Collapse-all / Expand-all.

Not shipped, named: the settings popover (the FA2 live-layout API is wired but
has no UI), force3d parity, a committed perf fixture, picker keyboard nav.

### Canvas (i3)

The canvas is a thinking surface (draw.io lineage), and this wave made direct
manipulation feel professional rather than merely functional.

- **Selection is a set.** `lib/canvas-selection.ts` owns one
  `CanvasSelection { nodeIds, edgeIds }` with single / Shift-toggle /
  rubber-band marquee / `Cmd+A`. Dragging any card in a multi-selection
  translates all of them. Delete/Backspace removes every selected node and edge
  with cascade edge removal — and deleting a kb-node *card* never touches the
  underlying graph node.
- **Undo/redo.** `lib/canvas-history.ts` is an immutable ring buffer
  (`MAX_HISTORY` = 30) with reference-equality skip; `Cmd+Z` /
  `Cmd+Shift+Z` / `Cmd+Y`.
- **Direct-manipulation invariants.** A 4px `DRAG_THRESHOLD` kills hair-trigger
  moves, pointer capture on card drags and resize handles survives a fast drag,
  four corner resize handles clamp at 80×40 (`Shift` locks aspect ratio), and
  arrow keys nudge 1px / 10px with `Shift`.
- **Snap guides and fit.** Alignment snapping is magnetic within 5px
  (`SNAP_TOL`) and draws dashed guide lines; `Shift+1` zoom-to-fit frames the
  bounding box with 40px padding. Zoom range is 0.1–3.0 (`MIN_ZOOM`/`MAX_ZOOM`).
- **Sticky tools.** `lib/canvas-tool.ts` is a pure reducer: picking a tool is
  one-shot (it returns to `select` after placing), double-clicking the tool icon
  makes it **sticky** for repeated placement, `Escape` always returns to select.
  Tools: select (V), text (T), rect (R), ellipse (O / C), diamond (D),
  group (G / F), kb node (N); digits `1`–`7` mirror the same order.
- **Edges are drawings** (the Logseq-whiteboards decision, unchanged): a live
  dashed bezier ghost during creation, smart port snapping by nearest Euclidean
  distance, 18×18px port targets, a 20px transparent hit path under the visible
  stroke, per-colour SVG arrowhead markers, and mid-path labels editable by
  double-click. `EdgeInspector` toggles arrowheads per end and picks JSON Canvas
  colours 1–6.
- **Floating selection toolbar** with Delete / Bring-to-front / Send-to-back
  (z-order is array reorder in the JSON Canvas doc).

Not shipped, named: cursor-centred scroll zoom (zoom is viewport-centred),
real Clipboard-API copy/paste, snap guides during keyboard nudge, edge colour
on the stroke itself, edge endpoint re-routing, group cards translating their
children.

### Cross-surface polish (i5)

The rules that hold everywhere, so no surface re-invents them:

- **One captured global shortcut.** `lib/keyboard-shortcuts.ts`
  `matchGlobalShortcut` returns `"global-search"` for ⌘/Ctrl-K and nothing else
  — ⌘S is deliberately left to the browser, because kb has no save action to
  bind it to. App-level dispatch lives in `components/App.tsx`.
- **The palette behaves like a dialog.** `components/palette/command-palette.tsx`
  records `document.activeElement` on open and restores focus on close, traps
  `Tab` inside itself, and keeps the active result scrolled into view.
- **IME composition is never interrupted.** Field editors track
  `compositionstart`/`compositionend` *and* check `nativeEvent.isComposing`
  before treating a key as a commit, so a composing CJK/dead-key sequence is not
  swallowed by Enter.
- **Load failures are recoverable, not raw.** An initial graph/workspace error
  renders a human-readable state with a Retry action and the technical detail
  behind a disclosure, rather than dumping the error.
- **Motion is a preference.** `index.css` carries one global
  `@media (prefers-reduced-motion: reduce)` block that flattens animation,
  transition and scroll behaviour across *every* surface — the graph cross-fade,
  the canvas, the outline — so an animated surface added later inherits the
  policy for free rather than opting in.
- Navigation affordances are keyboard-reachable: sidebar Home exits zoom, a
  closed sidebar is inert with focus returned to its toggle, breadcrumbs carry
  an accessible label and current-page marker, and tag chips expose real
  navigate / remove / configure buttons instead of click-only regions.

Deferred from i5 and still open: query-subscription error routing, view-settings
and Board setup flows, the Add-field flow, palette ranking/highlighting, URL and
history handling, and a toast-model redesign.

### Node-scoped commands: debug fields, pin

Two questions that look like settings are actually questions about one node, and
both are answered from the node ⌘K menu rather than from a device switch.

- **Debug fields are per node.** "Show me the `sys.*` and hidden props" is asked
  of the node you are inspecting. `stores/debug-fields.store.ts` owns the set of
  node ids that answer yes, persisted with the same `loadIdSet`/`saveIdSet`
  encoding the expanded rows use (key `kb-debug-fields`); it is the only reader
  and writer, so no component touches `localStorage`. The old device-wide
  `showAllFields` pref is **deleted**, not kept alongside — one switch that
  turned every page into a schema dump was the bug. `sys.cmd.debug-show-fields`
  in the global palette now toggles the selected row (or the zoomed root), the
  way the view-mode commands target a frame.
  - **Table and Board columns belong to the frame.** A header serves every row,
    so "per node" there can only mean the frame node that owns the view; a
    row's own field rows still follow the row's own flag. One flag, two
    honest readings of "which node".
  - *Migration (intentional breakage, same idiom as `loadExpandedIds`):* a
    user who had the global switch on has no id set to migrate to, so debug
    starts off and is re-armed per node. The stale key inside
    `localStorage["kb-prefs"]` is ignored on read and dropped on next write.
- **Pinning is listing.** `lib/pinned.ts` owns it: the seeded `pinned` node's
  **children** are contextual references (`sys.f.ref.target`) to the pinned
  nodes, and that list *is* the sidebar section. `mutations.togglePin` appends
  one such child or deletes it, and nothing else. Three things follow that a
  `pinned` supertag could not give (DESIGN.md →
  [Kinds, roles and options](./DESIGN.md#kinds-roles-and-options)):
  - **Order is data.** A tag is a set, so the sidebar had to invent an order
    and sorted by label. Children are ordered, and the outline's existing
    drag-reorder writes that order — the sidebar learned nothing about
    dragging, because `pinned` is an ordinary node you can open and rearrange.
  - **One node kind, reused.** A pin *is* a contextual reference: the row the
    outline already renders, backlinks already count, and ⌘K already mints.
  - **Nothing is written to the pinned node.** That is why the toggle no
    longer refuses `sys.*` targets — tagging edited the node's kind slot, so
    pinning `sys.queries` was a write to it; pointing at a node is not.
  - The list node is deliberately **not** `sys.`-prefixed, for the same reason
    `lens.all-mentions` is not: its whole purpose is to be written to.
  - **Naming collision, deliberately not merged:** an *ontology's* pins are
    `sys.f.onto.member` props with their own Unpin control on the ontology
    page. Same English word, different field, different mechanism.

### Optional UI plugins

Some UI plugins are off until the user switches them on. Which ones are on
is a device preference, `enabledPlugins` in `localStorage["kb-prefs"]` (a
list of plugin names), and it is edited in Preferences → plugins as one
on/off row per optional plugin. There is one mechanism, not a second path
beside the built-ins:

- `ui-plugins.ts` lists `BUILTIN_UI_PLUGINS` (always loaded) and
  `OPTIONAL_UI_PLUGINS` (each with the label and icon its preference row
  shows). `uiPluginsFor` turns the preference into the set of plugins the
  kernel should hold, and a built-in cannot be switched off by it.
- `lib/plugins.ts` → `syncUiPlugins` converges the UI kernel on that set:
  it loads what is missing and unloads each top-level plugin no longer
  listed. `startUiPlugins` runs it at boot and again whenever the preference
  changes, including from another tab.
- Unloading closes the plugin's scope, so its surfaces and sidebar section
  leave the kernel and every `useContributions` reader re-renders without a
  reload. A path the plugin owned then resolves like any unmatched path: the
  outline fallback takes it.
- Off by default means absent from the list. A name with no plugin behind it
  is inert, so shipping or retiring an optional plugin needs no migration.

### The lab

The lab (`components/lab`, `/lab`) is an off-by-default sketchbook for
real-time 3D: a place to study effects, lighting, polish and motion before
anything reaches a working view. It is the first optional UI plugin (above).
Its studies are exercises, not product features: a study **may** read the
graph (the Sky's stars are nodes), but it does not have to, and nothing a
study does is a kb milestone. What a study proves graduates into functional
views only through the shared kit — the graph-polish work (wave item g) builds
on the same stage, palette and timing, never on a copy of a study.

Four studies, each with a collapsible info card naming its technique, the
principles below it applies, and two to four live parameters:

| study  | technique                                                        | parameters                          |
| ------ | ---------------------------------------------------------------- | ----------------------------------- |
| Embers | TSL compute: a GPU spatial hash grid, contact heat, pops; bloom  | heat gain, cooling rate, pop threshold |
| Sky    | shader-drawn sprites (four-point glints), a nebula dome, dither   | glint length, nebula, dither        |
| Light  | key/fill/rim rig, soft shadows, GTAO, tone mapping, finishes     | tone mapping, PBR/matcap, AO, key angle |
| Motion | staggered critically damped springs against an eased tween        | settle, stagger, drive, overlap     |

The kit (`components/lab/kit`) is the one mechanism every study is built from
(P4): `stage` (renderer, post chain, tone mapping, palette uniforms, frame
loop, reveal), `study` (`mountStudy`: the reduced-motion and theme hand-off),
`timing` (the motion tokens, springs, eases), `tsl` (the typed TSL seam and
the ease as a shader function), `palette`, `rig` (lights and finishes), `pointer` and `pan` (pointer field, drag-to-turn with momentum),
`scene-host` and `info-card` (the React side). `three` is imported only by
the kit's GPU modules and the study scenes, and each study's scene is its own
dynamic import (`lab/three-import.boundary.test.ts`).

The renderer is three's `WebGPURenderer` (T1): WebGPU where the browser has
it, three's own WebGL2 backend where it does not, the same node code
compiling to both. Embers' collision grid needs storage atomics, which the
WebGL2 backend lacks, so that one study needs WebGPU (a recorded gap).

#### Lab principles

Every study follows these. They are the lab's rules, stated here once; a
study's info card cites them by id.

**Motion**

- **M1.** Nothing moves linearly except constant ambient rotation.
  Pointer-follow and settling use a critically damped spring or a
  frame-rate-independent approach (`1 - exp(-k·dt)`).
- **M2.** dt is clamped, so a tab switch never causes a jump.
- **M3.** Momentum and follow-through: drags carry inertia and decay;
  secondary elements lag the primary (overlap); stagger is small and
  consistent.
- **M4.** One hero motion at a time. Ambient motion is slow (periods of 8s or
  more) and small.
- **M5.** A visible reaction on the next frame, full settle in roughly
  300–600ms.
- **M6.** One timing vocabulary: durations, the ease and spring settle times
  come from the `motion.css` tokens (`kit/timing.ts` reads them; its fallback
  mirror is checked against the stylesheet), never retyped per study.
- **M7.** `prefers-reduced-motion` gives a still composition or a crossfade,
  never a half-animation.

**Light and colour**

- **L1.** A limited palette: one hue family and one accent, from the
  `--lab-*` tokens (the accent is `--primary`) through `lib/css-color.ts`.
  Value contrast over hue contrast.
- **L2.** Physically plausible light: a named key/fill/rim rig, a set tone
  mapping (ACES by default; AgX greys a light ground), sRGB output. Bloom's
  threshold is 1, so only HDR values glow and nothing glows by accident.
- **L3.** Depth cues: fog or atmospheric perspective, size attenuation, and
  falloff at the edges.
- **L4.** No banding in dark gradients: dither (a half-step of noise) in the
  post chain; the vignette is subtle.
- **L5.** A small shared material set with fixed roughness and metalness; never
  three's default grey.

**Composition and polish**

- **P1.** The hero sits at a focal point with negative space around it; the
  edges fade into the ground, no hard canvas edges.
- **P2.** No popping: shaders compile before the first frame is shown, and
  the canvas fades in over the ground.
- **P3.** A loading state, smooth resize, device pixel ratio at most 2,
  antialiasing, a steady 60fps, and no per-frame allocation in hot loops.
- **P4.** Uniformity: every study is built from the one kit; no per-study
  copy of a mechanism the kit owns.
- **P5.** The dark and the light theme both look intentional.

**Technology**

- **T1.** WebGPU plus TSL only: `WebGPURenderer` from `three/webgpu` (its
  WebGL2 fallback is three's, never a hand-rolled second path); every shader
  and compute kernel a TSL node graph (`Fn`, `uniform`, storage buffers,
  `compute()`) on node materials, never GLSL/WGSL strings or
  `ShaderMaterial`; post-processing a TSL graph (`PostProcessing`, `pass()`,
  `bloom()`, tone mapping, dither); the info card's parameters drive TSL
  `uniform()`s. Where three's TSL typings are looser than the nodes, the one
  typed seam is `kit/tsl.ts`. Plain CPU arithmetic that feeds instance data
  (the Motion field's springs) is not a shader and stays TypeScript. TypeGPU
  or raw WGSL only where TSL cannot express the thing, recorded as a gap.

Enforcement is honest: the three boundary, the timing mirror, the principle
bounds on the timing tokens (follow 300–600ms, ambient period 8s+), the pop
budget and the population invariant are tests; everything else here is prose
(the `#rule` node for the lab principles says so).

## Design tokens

A whole design system (colour, type, elevation, radius, faces) can be swapped
by redefining one set of custom properties. Components never carry a raw
value, so nothing has to be edited beside that set.

### Layers

| layer | file | holds | may name |
|---|---|---|---|
| 1. design system | `ui/src/design-system.css` | the values a skin chooses, as plain custom properties on `:root`, with the colour overrides under `.dark` | values only |
| 2. bridge | `ui/src/index.css`, `@theme inline` | the mapping from layer 1 into Tailwind's namespaces (`--color-*`, `--text-*`, `--font-*`, …) | layer 1 |
| 3. component roles | `ui/src/tokens.css` | row metrics, and the classes that compose layer 1 into a role (`.kb-text` is body text at the body step, `.kb-tag` a chip at the tag step) | layer 1 |

Components use layer-2 utilities (`text-meta`, `bg-popover`) and layer-3
classes (`kb-text`). The bridge is `inline`, so every utility compiles to a
`var()` of a layer-1 property rather than a copy of its value: redefining the
property on another selector re-skins every utility that reads it, at run
time, with no rebuild.

For every namespace kb owns, the bridge first resets Tailwind's defaults
(`--text-*: initial`). The only steps that exist are then the design
system's. A Tailwind default such as `text-sm` does not compile at all, so it
cannot pass as tokenized while bypassing the scale.

**Swapping a design system** means writing a block that redefines the layer-1
properties on its own selector. Layers 2 and 3 and the components do not
change. The selector that chooses between design systems, and the preference
behind it, are the next wave item (f2). Layer 1 is the contract that item
fills.

### Type scale

One step per font size the UI sets. A step sets font-size only; leading stays
with the element (`leading-*`, or the `.kb-text` role's `--kb-text-leading`).

| step | px | typical use |
|---|---:|---|
| `micro` | 9 | count badges |
| `caption` | 10 | mono ids, micro labels |
| `label` | 11 | chrome labels, buttons, uppercase section labels |
| `tag` | 11.5 | tag chips (`.kb-tag`) |
| `meta` | 12 | secondary text, menu rows, toasts |
| `ui` | 13 | inputs, palette rows, breadcrumbs |
| `note` | 14 | empty-state notes |
| `body` | 14.5 | node and field text (`.kb-text`) |
| `lead` | 16 | lead paragraphs, sub-headings |
| `heading` | 18 | section headings |
| `title` | 20 | the zoomed-root and page titles |

- **The names are ordered roles, one size each,** like Apple's text styles
  (caption, footnote, body, title). They are not t-shirt sizes. Tailwind's
  `xs`/`sm` already mean 12px/14px with a paired line-height, and kb's steps
  sit between them (11, 11.5, 13, 14.5px), so reusing those names would make
  `text-sm` mean something other than what every Tailwind reader expects. Nor
  are they a pure semantic set: several roles share a size, and the scale
  maps each px to exactly one step. "Typical use" says where a step is used;
  it does not restrict it.
- **Body text is a step, not a variable beside the scale.** `.kb-text` and
  `--kb-text-line` read `--type-body`. The tag chip likewise reads
  `--type-tag`.
- **tailwind-merge learns the names** (`lib/cn.ts`, `TYPE_STEPS`). Without
  that it reads an unknown `text-<name>` as a colour, and
  `cn("text-label", "text-foreground/50")` would drop the size.
  `lib/tokens.test.ts` fails if `TYPE_STEPS`, the bridge and the layer-1
  values ever list different names.

### Elevation

How far a surface floats above the page, lowest first. `--elevation-<level>`
in layer 1 is bridged as `shadow-<level>`, and Tailwind's `shadow-*` scale is
reset.

| level | used by |
|---|---|
| `edge` | the active segment of a segmented control |
| `raised` | canvas cards, ports and handles, a toggle's knob, small status chips |
| `lifted` | toasts, the ref autocomplete dropdown |
| `floating` | floating toolbars and legends over a canvas, graph tooltips |
| `overlay` | popovers and pickers (the popover anatomy of DESIGN-RESKIN §1.5) |
| `modal` | the command palette |

The levels are ordered and name a height, not a component. A new surface
picks the level it floats at. It does not get a level named after itself.
`ELEVATIONS` in `lib/cn.ts` is held to the bridge the same way `TYPE_STEPS`
is.

### Radius, borders, faces, colour

- **Radius** derives from one layer-1 value, `--radius` (the `md` step). The
  bridge computes `xs` (−4px), `sm` (−2px), `lg` (+4px), `xl` (+10px) and
  `2xl` (×2) from it, after resetting Tailwind's steps. Bare `rounded`
  (Tailwind's fixed 4px) is `rounded-xs`. `rounded-full` is a shape, not a
  step.
- **Borders** are Tailwind's 1px hairline. No layer-1 width exists: a
  `--border-width` property was declared that nothing read, so it was
  deleted rather than kept looking like it was wired.
- **Faces.** `--app-font` is the UI face, switched by the `data-font` pref.
  `--app-font-mono` sets ids, code and EDN (`font-mono`, `.kb-md-code`).
  `--app-font-graph` sets graph labels: `font-graph` in the DOM, and on
  canvas through `graphLabelFont()` (`lib/graph-label.ts`), because a canvas
  `font` string cannot hold a `var()`. No `font-family` outside layer 1 names
  a family.
- **Colour** is the oklch palette, bridged as `--color-*`. Two
  theme-independent tokens cover what used to be Tailwind's `black` and
  `white`: `scrim` (the dimming layer behind a modal) and `knob` (a toggle's
  knob). Canvas renderers read colour through `readTokenColor`
  (`lib/css-color.ts`), which owns each token's no-document fallback, so no
  component carries a colour literal. The lab's palette (`--lab-*`, Lab
  principles L1) is layer 1 too, read the same way by `lab/kit/palette.ts`.
- **Canvas-drawn values are outside the Tailwind scale, on purpose.** What a
  renderer paints on canvas or WebGPU is not a class: the graph label sizes
  (11–12px in `sigma-labels.ts`, `cluster-hulls.ts`, `tree-graph.tsx`,
  `force3d-graph.tsx`) and the lab scenes' geometry, light and bloom
  values belong to their renderers. Their colours and faces still come from
  layer 1 (`readTokenColor`, `graphLabelFont()`). Their sizes are scene
  parameters, and no type step names them. The lab's DOM chrome (info card,
  curve panel, scene switcher) is ordinary UI and uses the scale.

### A dead token is a duplicate

`lib/tokens.test.ts` fails when a layer-1 property is read by nothing, which
is how `--border-width`, `--font-weight-emphasis` and the one-use radius
aliases were found and deleted. It also fails when the scale lists in
`lib/cn.ts`, the bridge and layer 1 disagree.

## Layout

```
tools/kb/
  packages/app/server/src/index.ts              # stable facade (re-exports startUi / runUiCli / …)
  packages/app/server/src/
    server.ts                    # Bun.serve boundary + Effect Scope stop + fs-watch
    http.ts                      # Effect REST/API + asset GET + SPA fallback
    session.ts                   # Effect SubscriptionHub (WS protocol)
    assets.ts                    # Effect ui/dist static + .kb/assets
    saved-queries.ts             # Effect .kb/queries listing / virtual nodes
    paths.ts                     # KB_PKG_ROOT, UI_DIST
  packages/contract/contracts/src/protocol.ts        # WS/HTTP message types (zod) — shared contract
  ui/                            # Vite app (own package.json)
    src/{stores,components,ds}/ ...
    dist/                        # built assets, committed? → no: built on demand
```

`kb ui` with no `ui/dist`: auto-builds on first run and caches — the command
shells out to `bun install && bun run build` (`vp build`) in `ui/` when the
SPA is missing or **stale** (a source fingerprint written to
`ui/dist/.kb-build-hash` at build time vs the current sources; a rebuilt
install that touches lockfiles cannot loop). Fresh build = fast no-op.
`kb ui --dev`: spawns the Vite dev server (`vp dev` on 5173, `--dev-port` to
override) as a child of the kb backend and proxies `/api`, `/assets`, `/ws` to
it via `KB_UI_API_PORT`; the child is killed on SIGINT/SIGTERM and the backend
stops when the child exits. No new global deps.

## Milestones (max parallel)

Contract first, then two independent tracks, then join:

- **U0 (me, small)**: `packages/contract/contracts/src/protocol.ts` — zod types for HTTP/WS
  messages + written API contract in DESIGN-UI.md. Everything else codes
  against this.
- **U1 server (cursor)**: `kb ui` command — Bun.serve static+API, fs-watch,
  SubscriptionHub v1, tests via WS client. Depends on U0 only.
- **U2 frontend shell (cursor)**: Vite app, graph load → client DataScript,
  read-only outline (fork nxus components), search, collapse/zoom. Talks to
  a mock server built from protocol.ts fixtures. Depends on U0 only. ∥ U1.
- **U3 editing (cursor)**: mutations pipeline (optimistic tx → action POST),
  props/tags editors, [[ref]] autocomplete, backlinks. After U2; runs ∥ U4.
- **U4 query page + live wiring (claude)**: datalog/saved-query page, WS
  client, tx-delta ingestion, persistence polish. After U1+U2; ∥ U3.
- **U5 (me)**: integrate on main, e2e smoke (playwright against `kb ui`),
  docs (AGENTS.md note), commit.

Cursor:claude stays ≈3:1. Same orchestration recipe as last wave
(explicit `cursor-agent --trust -f` terminals, inject, verify, review each
diff with cavecrew-reviewer, I fix and merge).

## MCP Apps backbone (this wave), apps later

New module `packages/application/operations/src/render.ts`: `render(queryRows, template, format: "html" | "md")`
— pure functions, no deps. Consumed by three surfaces from day 1:
1. md materializer (existing templates migrate onto it),
2. web UI's rendered-view panel (saved query → html block),
3. kb MCP registers `ui://kb/view/<name>` resources + a `render_view` tool
   returning the html (MCP Apps extension shape).
Later "apps" = new template + query pair, registered by name. On-the-fly
generative UI (model writes the template at answer time) also lands on this
API — the client just passes a template string instead of a name.

## Packaging ("app like other apps") and dist

Decision: **don't commit `ui/dist`** — built artifacts in git churn every
diff. Instead, two install shapes:
- Now: checkout-based (global `kb` wrapper already installed by HM); first
  `kb ui` run builds `ui/dist` into a gitignored dir, cached until sources
  change (source fingerprint vs `ui/dist/.kb-build-hash`). Fresh machine cost:
  one `vp build` (~seconds), automatic.
- Clean "like other apps" shape, when the tool stabilizes: a **nix package
  in `pkgs/`** (buildable derivation: bun deps pinned via lockfile hash, vp
  build in the sandbox, wrapper binary), installed from `home.packages` like
  chat2db/logseq-nightly. Then `rebuild` ships kb+UI as a versioned unit and
  no checkout is needed. Homebrew cask adds nothing over that for a personal
  tool. Backlogged as a kb todo, not in this wave.

## Workspace motion and exploration

`WorkspaceState` owns loading and empty-state presentation across the app. Its
decorative node companion uses CSS shading and vector curves, stays sharp at any
pixel ratio, and performs one finite arrival and glance. Readiness never waits
for animation. Loading copy is a live status; decorative shapes are hidden from
assistive technology. `motion.css` owns these gestures and the shared palette /
toast entrance; the global reduced-motion rule applies to all of them. Editing
rows and text do not move.

`WorkspaceBoundary` unifies explicit data loading and lazy module loading.
Ready content fades in over 280ms using opacity only; it mounts and accepts input
immediately, with no minimum loading time. Ordinary data updates preserve the
mounted content and any active edit. The catalog includes a loading-to-ready
study to inspect this transition.

Explicit device-theme changes use a single browser View Transition around the
preference commit, so text, DOM surfaces, and canvas snapshots crossfade together.
The shared theme glyph turns between sun, moon, and system icons. Reduced motion
and browsers without the snapshot API apply the preference immediately. Rapid
choices supersede earlier pending transitions; boot and cross-tab synchronization
stay immediate.

The component catalog's `Workspace/WorkspaceState/Study` is the isolated motion
preview: replayable light/dark examples, with no workspace data access. This is
the first place to review visual experiments.

Proposed in-app playground: an ordinary canvas named Playground, reached through
existing canvas navigation (and existing pinning if desired). Contents remain
nodes and assets, with the same editing and deletion model as other canvases.
Future interactive 3D scenes need a reusable asset/view contract before adding a
renderer; a bespoke playground datastore or app-wide pet overlay is not part of
this direction. (Technique studies live in the lab — see The lab — and reach
working views only through its shared kit.) Three.js WebGPU/TSL and Blender glTF assets are candidates for
that renderer. TypeGPU requires a measured compute use case. Smooth silhouettes,
antialiasing, readable text, and no accidental polygon faceting are acceptance
criteria. See `docs/kb-graph-audit-2026-09-06.md` at the repository root for the
graph interaction and rendering repair proposal.

Milestone direction (proposal): **a new bridge**. After a successful, deliberate
relationship creation joins two previously disconnected groups in the current
graph perspective, the new edge receives one short pulse and its endpoints
respond. This marks a structural event rather than guessing that more nodes or
completed tasks mean progress. All relation forms participate according to the
perspective's semantics. Loading, imports, filtering, failed writes, undo/redo,
and remote changes must not trigger a celebration. Keep it transient and local
to the relationship; do not add a parallel achievement datastore or a universal
task/streak model. Implementation is deferred until the shared relationship
creation path exposes the confirmed gesture and before/after graph consistently.

Art direction for future graph atmospheres (proposal): Observatory (nodes as
stars, relationships as constellations), Porcelain (smooth ceramic forms in
daylight), and Ink (precise points and fine lines). Atmosphere belongs to the
existing perspective as a relationship to an allowed-value node. A curated
shuffle may change this presentation without changing node identity, query,
semantic color mapping, selection, or camera. It must use the renderer's supported
settings contract and preserve readable labels, smooth silhouettes, and a clear
distinction between real graph elements and decoration. This is not implemented
by the current graph repair.

## Port

Fixed default `4321`, `--port` override, auto-open browser on start, bind
127.0.0.1 only. **Portless later** (noted as backlog): unix-domain-socket
transport for local subscriber apps + `kb ui` finding a free port and
registering it in `.kb/runtime.json` for discovery; browser still needs a
TCP port, everything else can go UDS.


### Field-based graph perspectives (2026-09-07)

The graph-first product principle lives in [AGENTS.md](../../AGENTS.md).
A graph perspective is an ordinary `#graph-perspective` node. Its query selects
nodes; its relationship sources select edges; its encodings map fields to label,
color, size/area and group. The UI edits the existing lens fields and “Save as
new perspective” creates a new node through the shared action pipeline. It does
not create a separate preset store. New source values reference field nodes or the
seeded source options; renderer choices reference the seeded renderer options.
Both option sets are declared by parenting rather than by a supertag — the five
renderers are `lens.renderer`'s own children, and the ten sources are one
`sys.graph.sources` list that each source-selecting lens field narrows by
`kind` through a `targetQuery` (DESIGN.md → Kinds, roles and options).
Legacy string settings remain readable and existing values are not rewritten by
seeding. Search, selection, legend dimming and camera position are transient.
Ontology membership remains a separate scope on the same projection.

`packages/app/ui/src/components/graph/graph-renderers.ts` owns each renderer's
adapter, supported encodings, settings and interaction capabilities. The shared
frame disables unsupported camera operations with a reason. A new renderer
registers that contract and consumes the same extracted nodes and edges. The
stable source/renderer vocabulary lives in `@kb/model`; browser components never
reach into backend files through aliases.

Tree is a deterministic spanning projection of the chosen directed edges. Each
node occurs once, including in graphs with cycles or shared descendants; this
never changes the stored relationships. Collapse preserves scale and anchors
the clicked branch at its prior screen position. Treemap uses the selected group
and area encodings. Numeric fields sum finite values, clamped to zero; zero and
missing measures receive no area and are counted explicitly. Equal size shows
all nodes. Category and label fields use their displayed values, resolving node
references to human text. Legend toggles dim the chosen category; overlapping
search/filter/focus constraints preserve a readable minimum opacity.

Engine direction: retain Sigma/Graphology for 2D networks, d3-hierarchy for tree
and treemap, and Three.js/3d-force-graph for 3D. This change does not add another
rendering dependency. [Cytoscape.js](https://js.cytoscape.org/) and
[AntV G6](https://github.com/antvis/G6/tree/v5) are viable graph-engine alternatives,
but adopting either would require a measured capability/performance advantage.
Borrow [G2's](https://github.com/antvis/G2/tree/v5) separation of data, transforms,
and encoding channels, and [Bloom perspectives](https://neo4j.com/docs/bloom-user-guide/current/bloom-perspectives/bloom-perspectives/)
as a product precedent for saved views of one graph.
[Neo4j NVL](https://neo4j.com/docs/nvl/current/) accepts node/relationship data
through adapters; using a Cypher ecosystem renderer would not require changing
kb's datastore or query model.
