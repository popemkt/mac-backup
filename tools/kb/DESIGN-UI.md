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
| `invoke.ts` | how the server runs an invocation it is handed: reload, then the invoke core |
| `session.ts` | Effect `SubscriptionHub` (clients, message processing, broadcast, cleanup) |
| `assets.ts` | Effect SPA `ui/dist` static + `.kb/assets` serving (`Bun.file` body at boundary) |
| `saved-queries.ts` | Effect list/materialize `.kb/queries/*.edn` |
| `paths.ts` | `KB_PKG_ROOT`, `UI_DIST` |

- **Client DataScript**: browser loads all nodes once, builds the same datom
  set the CLI builds (shared `foundation/query` code — it's isomorphic TS, no
  node APIs in the datom builder). Keystrokes never wait on the network.
- **Mutations**: `session/runtime.ts` invokes isomorphic actions against the
  browser's `BrowserStore` and existing DataScript index first, then sends the
  same invocation through one ordered `POST /api/action` push lane. The local
  write stays visible until its receipt is confirmed, under the hold rules of
  [Replica sync](#replica-sync). An isomorphic action whose declared mode is
  a read is answered from the replica and never pushed, since it has nothing
  to replicate. Port-only actions remain server-owned.
  Cold-boot `loadGraph` may fall back to fixtures; `hydrateFromWire` is
  boot-only — live resync uses `refreshFromWire` so `loadSource` stays `api`.
  No temp-id dance (nxus's pain): client mints final ULIDs, server accepts
  explicit ids (already supported by `node.add`).
- **Change flow**: server fs-watches `.kb/` (catches CLI/MCP/agent writes
  too) → reloads nodes → rebuilds a DataScript database → broadcasts node-level
  deltas on WS → the client applies deltas → open queries re-run.

### Replica sync

The browser replica is the server's graph as of one `rev`, with the local
writes the server has not confirmed laid over it. One state machine,
`BrowserReplica` in `session/replica.ts`, owns that. `KbWsClient` carries its
messages and asks `since` on its behalf, `api/live.ts` runs the snapshot fetch
it asks for, and the outline store projects what it applies. None of them
reads a rev.

**State.**

- `rev` is the server rev the replica stands on. There is one rev space, the
  server's. Only an applied frame or an installed snapshot moves it.
- The **server image** is every node as the server had it at `rev`, including
  held ones.
- A **hold** is opened by each local write that is pushed. It carries the ids
  that write's local commit touched, and `at`, the rev named by its receipt
  (unknown until the receipt arrives). A held id shows its local image, and
  every other id shows its server image.
- The **phase** is one of `live`, `catching-up(from)` (a `since(from)` is
  outstanding) or `awaiting-snapshot(fetching, failures)`.

**Transitions.** Each row is an event and each column a phase. "fetch" means
`GET /api/graph`, and "fetch unless fetching" leaves an in-flight fetch alone.

| Event | `live` | `catching-up(from)` | `awaiting-snapshot` |
|---|---|---|---|
| `tx`, rev ≤ `rev` | ignore | ignore | ignore |
| `tx`, rev = `rev`+1 | apply | apply, → `live` | ignore: the snapshot and its `since` cover it |
| `tx`, rev > `rev`+1 | `since(rev)`, → `catching-up(rev)` | `since(rev)` unless `from` = `rev` | ignore |
| `hello`, head = `rev` | stay | → `live` | fetch unless fetching |
| `hello`, head ≠ `rev` | `since(rev)`, → `catching-up(rev)` | `since(rev)` again: a new socket has no question outstanding | fetch unless fetching |
| `snapshot-required` | fetch, → `awaiting-snapshot` | fetch, → `awaiting-snapshot` | fetch unless fetching |
| snapshot fetched | ignore | ignore | install, `since(snapshot.rev)`, → `catching-up(snapshot.rev)` |
| snapshot fetch failed | — | — | not fetching; retry after 500 ms, doubling to 10 s |
| retry due | — | — | fetch unless fetching |
| `reconcile` (a push failed) | `since(rev)`, → `catching-up(rev)` | `since(rev)` unless `from` = `rev` | ignore |

**Apply a frame.** The frame's upserts and deletes go into the server image.
The visible replica takes them only for ids that no hold holds. `rev` becomes
the frame's rev, and every hold whose `at` ≤ `rev` is released.

**One view update per entry point.** The machine is moved through events in
bursts (`receiveAll`; `receive` is a burst of one), and what a burst — or a
settle, or a drop — decided the visible replica takes is applied once, at
its end, at the rev it ended on: the net change per id, so a burst of frames
is one outline projection, not one per frame. An installed snapshot replaces
whatever the burst had taken before it. `api/live.ts`, the one place live
events enter the machine (socket messages, the fetched snapshot, a retry),
queues them and hands them over as one burst per animation frame (on a timer
in a hidden tab), so the live stream costs at most one store update per
frame. Holding an event for a frame is latency to the machine, which the
table already tolerates.

**Install a snapshot.** The snapshot becomes the server image and `rev`
becomes its rev, even when that is below the old one. Every hold whose `at` ≤
`snapshot.rev` is released, because the snapshot contains that write whether
or not a frame for it was seen. The visible replica becomes the snapshot, with
each id that is still held keeping its local image.

**Holds.**

- A write's hold is settled by its push's receipt. A succeeded receipt
  carries `rev`, the server log's head once the invocation had committed, so
  every frame it caused is at or below it. The hold records `at` and is
  released when `rev` reaches it, at once if `rev` already has. While the
  replica awaits a snapshot, the snapshot's install decides instead. A write
  the server commits as a no-op causes no frame, and is released the same way.
- A failed receipt or a thrown push drops its hold at once, then reconciles.
- Releasing a hold shows the server image, including an absence, for each of
  its ids that no other hold still holds.
- Typed text is a write too. The node's first keystroke opens a hold, later
  keystrokes join it, and the coalesced flush is the push that settles it. A
  structural write flushes every pending text first, and the one push lane
  keeps them in order, so no text is discarded, including that of a node
  about to be deleted.

**What the table guarantees.**

- Only the server escalates to a snapshot. The browser fetches `/api/graph`
  only after the server answered `snapshot-required`. A failed push asks
  `since` and nothing more.
- `awaiting-snapshot` is left only by installing a snapshot. A hello at the
  replica's rev does not clear it, and a failed fetch is retried until one
  lands.
- No frame is applied over a snapshot it predates, and none is lost to one.
  Frames that arrive while the snapshot is fetched are ignored, and are
  replayed by the `since(snapshot.rev)` that follows its install.
- A frame never rolls back a local write that is newer than it. The frame
  lands in the server image, under the hold.

A server whose head is behind the replica's rev (its tail was replaced, not
restarted: `rev` survives a restart, see `protocol.ts` → `GraphSnapshotSchema`)
is not treated as a special case. The replica asks `since(rev)`, the server
answers `snapshot-required` for a rev ahead of its head, and the snapshot's rev
is authoritative. The browser never infers a restart from a head.

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

**Node text is one surface, read or edited.** There is no raw-source edit
mode. `lib/md-edit.ts` `inlineNodes` is the one description of what inline
markdown renders as; `renderInlineMarkdown` builds it as DOM and `InlineMarkdown`
(`components/ui/md-view.tsx`) as React, and a parity test holds the two to the
same markup. Every source character is in that tree: a formatted segment keeps
its delimiters (`**`, `` ` ``, `[`/`](href)`) as `.kb-md-mark` text beside the
formatted element, hidden, so the DOM serializes back to the stored string
byte for byte and a DOM caret position *is* a serialized offset. Entering edit
mode therefore swaps nothing visible: the row's text element becomes
contentEditable over the same tree, a click lands where it was aimed
(`offsetFromPoint` on the tree the editor edits), and only the segment the
selection touches shows its delimiters, faint (Obsidian-style live preview;
`revealMarkupAtSelection`). Typing that changes what the text means — the
second `*` of `**`, breaking a link — rebuilds the tree around the caret
(`isCanonicalInline`); typing inside a segment leaves the browser's DOM alone. A
boundary caret rests outside hidden markup, so typing after `**b**` is plain.
While editing, the DOM is the text: it is rebuilt from `content` on mount and
when `content` moved on its own (a merge), never from a `content` still behind
the editor's own writes. Text undo inside the row is the host's
(`lib/text-history.ts`, `components/ui/use-text-history.ts`), recorded from the
row's `content` stream so every write path — typing, `[[` completion,
Shift+Enter — is covered, because native undo cannot follow a rebuilt tree;
structural undo stays the store's (below).

**Refs are atomic in the editor.** `[[id|label]]` renders as a
`contenteditable=false` link carrying its serialized token, in both states, so
a raw ULID never faces the caret and serialization round-trips canonical
markdown. The caret rests beside a pill (in its parent), never inside it. A
click on it navigates whether the row is being read or edited
(`routeInlineClick`).

**A bare url is a link.** The inline grammar (`lib/md-inline.ts`) autolinks a
bare `http://`, `https://` or `www.` url the way GFM's extended autolink does:
it starts at the text's start, a space or one of `*_~(`, runs to whitespace or
`<`, and leaves trailing sentence punctuation and a `)` it did not open
outside it. It is the same link segment `[label](url)` makes, with no markup of
its own — its label is its own spelling, so it rebuilds byte for byte, and
`www.` gains its scheme in the href only (`@kb/model`'s `normalizeUrl`, the url
field's form) — so it renders, edits and follows exactly like a markdown link,
in node text and text field values alike. Segments are flat, so a url inside
code, emphasis or a link's label stays what that segment makes it. A url or a
number *value* is not markdown: its editor is its plain string, so the url
field's own text is never autolinked while it is typed.

**Links are two kinds, told apart at a glance** (Tana's). A reference
(`[[id|label]]`) stays in the graph: it wears no mark, and its label is drawn in
its target's first tag colour, inked the way a tag chip's text is (`refInkOf`
and `tagInk` in `lib/tag-color.ts`), or in the link colour when the target is
untagged. A link — `[label](url)`, a bare url, a url field's value — leaves
the graph and wears the external-link mark before its label
(`.kb-md-link::before` in `tokens.css`: a pseudo-element, so it is never text
the editor serializes or a caret offset counts). The kind is decided once, in
the inline tree: `inlineNodes(text, ink)` takes a `RefInk` — how a reference's
target is inked — from the surface, because `lib/md-edit.ts` knows no graph,
and carries it on the reference as the `--kb-ref-ink` custom property. Every
surface passes one (`useRefInk` for the read-only `MdView` surfaces, the
schema they already hold for node text and text values); a missing one is a
compile error, not an uncoloured reference. Tana also shows a target's own
icon or emoji before its label; kb's model has no node icon, so there is none
to show.

**The bullet is one definition.** `lib/bullet-mode.ts` decides everything a
bullet shows — its kind and shape, its glyph, whether it has a halo, the
paints of its halo, dot and ring (a node's tag colours, or the ink at a
stated strength when it has none) and its geometry (the 24px box, the 4px
leaf and 5px parent dot, the halo inset, the 18px ring with its stroke and
its dashes fitted whole to the circle, and the query magnifier as a lens and
a handle rather than a copied path) — as one record,
`BulletAppearance`, and `outlineBulletAppearance` reads it off an outline
node. `Bullet` renders that record and decides nothing; the graph's bullet
theme paints the same record (Graph → The themes), so the two cannot drift.

**A row depends on what it reads, not on the graph.** The outline store
holds the graph as whole values — the projection (`nodes`), the schema
(`schemaOf`) and the query index — and every graph change, expand or
collapse replaces the maps. Two properties keep that from costing a render
per row:

- The projection is persistent. `wireToOutlineMap` takes the projection it
  replaces and keeps a node's object when the node projects to the same
  value, so a node's identity changes exactly when what it shows does; the
  schema does the same per snapshot.
- A row reads the graph through `useGraphRead` (`stores/graph-read.ts`):
  the outline, schema and index as views that record which ids were asked
  for (a walk records the whole map, a query the index generation). The view
  is renewed, and the row re-renders, only when one of those reads changed —
  an outline entry by identity, a schema entry by `sameMeaning`, since a
  schema reader never asks about expansion. Reads always answer from the
  store's current maps, so a read added later is never stale. It is a
  selector over the one store, not a second copy of it. The rows, their
  text host binding, their fields section and the list frame view read
  this way; focus, selection and caret placement are selected per instance
  (`activeNodeId === nodeId && activeInstanceKey === instanceKey`), not as
  store-wide values.

So a one-node change re-renders that node's row (and the list frame view
above it, which renders the same memoized children); an expand re-renders
the toggled row and mounts its subtree; moving the selection re-renders the
two rows it moves between. `components/outline/update-cost.test.tsx` pins
all three. The `[[` candidates (`nodeCandidates`, label order derived once
per map) are computed only while a popup is open.

**`sys.*` rows are read-only at the door.** `store.activateNode` degrades a
`sys.*` id to selection so no caret ever enters one; the row shows a hover
padlock instead of failing on write.

### Contextual references (2026-08-27)

Tana's *reference*, expressed with no new storage shape and no new
widget: a **contextual reference is an ordinary node** carrying its target on
the `sys.f.ref.target` ref field. The field is the whole declaration — no tag —
because a node with no target is not a reference (DESIGN.md → [Kinds, roles and
options](./DESIGN.md#kinds-roles-and-options)). Same anatomy as a query node
(`sys.f.query`), so collapse state, instance keys, both keymaps, undo and the
transient rules are the ordinary ones, and `frame-rows.ts` did not change:
a reference row's frame is simply its target.

`packages/app/ui/src/lib/contextual-ref.ts` owns the rules that make it read as a
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
- **The row shows its target; its place is its own.** `shownNode(node,
  schema)` is the one answer to "which node does this row show" — the target
  for a reference, the row itself otherwise (and for a dangling reference) —
  and every content read of a row goes through it, on every surface (list row,
  table row, card) and in the keyboard walk: the text (`rowText`, the one text
  channel `NodeContent` renders and writes), the tag chips, the bullet's
  paint, the field rows and table/card cells, the children and query results
  under the row, its view, what the reveal chords and ←/→ count as its
  children, where `o` and the create-child strip mint a child, and the page
  ⌘-click and the zoom chord open. So a reference row reads exactly like its
  target as an ordinary row, and every write it makes lands on the target, as
  in Tana. What stays on the reference node is its **place** — the parent
  edge, sibling order, selection, instance key, collapse, Tab, moves and
  delete — so the one row↔node identity that instance keys, both keymaps,
  optimistic mutations and undo are built on is not forked, and deleting the
  row deletes the reference, never the original. Children of the target drawn
  under a reference get instance keys under the *reference's* key
  (`tree/…/ref/child`), so the same node shows at two places with two
  identities, exactly like a query result. The keymap's `ownsText` is the one
  place the text difference shows: Enter on a reference opens the next row
  instead of cutting the original's text (`planSplit(…, "end")`), and the
  text-joining chords (Backspace at offset 0 merging up, Delete at the end
  merging the next row in) are claimed inert when either string is not its
  row's own, because there is no string of the row's to join.
- **A reference never expands into itself.** Showing the target's children
  makes the outline a graph walk, so a reference under its own target (or two
  references pointing into each other's subtrees) would recurse forever.
  `showsAncestor(instanceKey, node, schema)` is the stop — the row's shown node
  is already shown by a row on its instance path (`instanceAncestorIds` in
  `lib/instance-key.ts` reads the path) — and `resolveRowChrome` and the
  visible-instance walk both read it, so such a row is a leaf in the render
  and in keyboard navigation alike.
  `rowTextReadOnlyReason(id, node, schema)` owns what cannot be written: `sys.*`
  text (whether the row is the sys node or a reference to it, r1 D20) and a
  reference whose target is missing; it supplies the padlock's wording.
  *History:* until 2026-09-27 the reference's text was read-only and a click
  opened the original; that was rejected on the grounds that it made a
  reference a different kind of row to click and type into. Until 2026-09-28
  only the text was routed — tags, fields and children were the reference
  node's own ("contextual content") — which made a reference to a tagged node
  render as bare text; the owner's rule since is that a reference row renders
  exactly as its target would, the dashed bullet being the only difference.
- **The bullet reuses the existing reference treatment** (dashed ring). Only the
  bullet: a *query-result* row — read from its instance key by
  `isQueryResultInstance` (`lib/instance-key.ts`), never passed as a flag —
  keeps suppressing nested query results, the create-child strip and the
  structural chords, because its place under the query is computed rather than
  a child edge. A contextual reference is a real child whose children **are**
  its own, and creating them is the whole point. `isReferenceRow(node,
  isQueryResult)` in `lib/row-chrome.ts` is the one answer, read by the list
  row's chrome and by table and card rows alike. Apart from those gates a
  result row is clicked like any row in every view: a row click selects, a
  text click edits, a bullet click toggles and ⌘-click opens the node.

**A reference shows its target's children, not its own.** The reference
node's own children, if it has any, are not drawn anywhere: nothing creates
them any more (the create-child gestures under a reference mint under the
target), and a store written before 2026-09-28 holds none.

**Creation** is a node-⌘K step, next to *Turn into query*: **Turn into
reference…** opens the picker, which is the same picker `Add tag` and `Add field`
use — generalized from two kinds to three, with the candidate *source* as the
only difference. A reference's candidates come from `nodeCandidates`, the
source the `[[` autocomplete and the field picker share, over the one picker
engine (→ [Field values](#field-values-one-slot-grammar)), so no fourth node
picker was added. The gesture itself is `mutations.addTag` +
`mutations.updateProp`, i.e. plain `node.update` — no new registry action, and
the CLI/MCP form is in DESIGN.md.

**Named gaps.** The reference node's own props — its target among them — are
not drawn by its row, since every field row is the target's; the target is
repointable only from the CLI or MCP (`node.update`), and *Turn into
reference…* is withheld from a row that already is one. View filters, sort and
board grouping read a row's own props, so a reference inside a table or board
sorts and groups as an empty node. Enter at the end of an expanded reference
opens a sibling, where an expanded ordinary row opens its first child, because
`planSplit` reads the row's own children. The References list shows a
reference by its rendered target text rather than by the ancestor context it
sits in, so on the original's own page a reference row reads as a copy of the
original's text; a context breadcrumb is the obvious next step and is not
built. There is no global ⌘K entry: a contextual reference needs both a host
row and a target, and the global palette has no two-step for that.

### Field values: one slot grammar

A node's field values are drawn by one component on every surface —
`NodeField` (`components/outline/fields-section.tsx`): the outline's field
rows, a table's cells and a card's fields are `FieldRow` chrome around the one
`FieldValueStack`, so none of them has its own loop of editors. Each value sits
in a **value slot** (`ValueSlot`, `components/outline/value-slot.tsx`), and
**the slot owns every gesture**; a value's kind contributes only data. A kind
is a row in `VALUE_KINDS` (`lib/value-kind.ts`: its editor mode, how it reads
as text and back, when it is blank, where it points, how its values sit
together) and a row in the slot's view registry (its glyph and its surface).
The surfaces in `field-value.tsx` draw and edit; none has a click or key
handler of its own. A new type is two rows, never a component deciding its
own clicks.

**The label column belongs to the field, not to its values.** The type glyph
is the field's own button (`FieldRow`, labelled "Configure field <name>"). A
field is a node and its page is where it is configured — its type, its
target, its values' kinds — so the glyph follows the field the way a bullet
follows its node: a plain click opens it, ⌘/Ctrl-click reveals it. A row that
stands for no field node (a preference) draws the glyph inert.

**Three verbs, the same on every kind.**

| Verb | Mouse | Keyboard |
|---|---|---|
| **Follow** (a ref's node, an option's page, a url) | plain click on a *pointer segment* — a ref label, an option chip, a url's link, a `[[ref]]` pill in text — exactly as in node text; ⌘/Ctrl-click anywhere on the value | ⌘Enter, at rest or editing |
| **Edit** | plain click anywhere else in the slot; a caret lands where the click did | Enter or F2; a printable key opens it with that key typed (replacing the value; a picker starts its query with it); Space flips a checkbox |
| **Add** (many-valued fields only) | the "+" in the trailing space of the last value, on hover or focus | Enter at the end of a typed value; the picker, which stays open |

Following is one function for every pointer in kb (`lib/follow.ts`:
`routePointerClick`, the bullet rule `bulletClickIntent`, and `useFollow`,
which carries a follow out); a url's link is a real anchor, so the browser's
open, middle-click and context menu work.

**Keys.** At rest (the slot focused, its editor closed): ↑/↓ and
Tab/Shift-Tab move through the field's values and out to the row; Backspace or
Delete takes the value out; Escape hands the keyboard back to the row,
selected. While a caret editor is open: Enter commits (Shift+Enter is a line
break in text), Escape reverts and leaves the value focused, Tab or an arrow
off the text's first or last character commits and moves on, and Backspace in
an emptied value takes it out and opens the one before. A picker and the date
editor keep their own keys. The chord tables are `lib/value-slot-keymap.ts`.
The rows' keymaps pass through the values: ↓ off a row's last line (editing
or selected) lands on its first value, ↓ from its last value goes to the next
row, ↑ comes back the same way (`enterFields`; the order is read off the DOM
by `lib/value-slot-nav.ts`, never kept a second time).

**Adding has no line of its own.** Enter at the end of a value of a
many-valued field commits it and opens the next value's slot; Enter on that
empty slot closes it. A typed value emptied is taken out, not kept blank.
Picked values are added in the picker. A one-valued field — and a checkbox,
which holds one value by its type (`cardinalityOf`) — offers no add.

**Per kind.**

- **text** is node text: it renders and edits through the same live preview
  (`readInlineInput`, `useRevealMarkup`), and a `[[id]]` token in it is a
  mention like one in node text (DESIGN.md → Refs, `nodeMentions`).
- **url** is a link at rest, labelled short (`urlLabel`), the full url its
  title. Its form is `@kb/model`'s (`normalizeUrl`: http(s)/mailto, a bare
  host made https, every other scheme refused), and every surface parses
  input through the one `parseTypedValue`, which the write check agrees with.
- **number** reads and writes in the browser's locale (`lib/number-format`),
  grouped at rest and ungrouped while edited.
- **date** is a local calendar day (`@kb/model` `local-date`), labelled near
  today (Today, Fri, Oct 12), edited in `DateEditor`: typed phrases
  (`parseDateInput`: tomorrow, next fri, in 2 weeks, oct 3) with a live
  preview, over a keyboard-first calendar.
- **checkbox** is a checkbox, not a switch.
- **ref** is its target's row; the label follows, the rest of the row edits.
- **option** — a ref field that declares its values by parenting them
  (`declaresOptionSet`) — is a chip drawn in the tag chip's box, in the
  option's colour (`optionColorOf`); a field's chips wrap on one line.

Input a kind cannot read is never dropped: the slot keeps it, marked with the
reason, and the next edit starts from it.

**The one node picker.** Every "which node?" in the UI is one engine
(`lib/picker.ts`: candidates in, ranked rows out; `usePickerKeys`) and one
list (`components/ui/picker-list.tsx`): the field picker (`FieldPicker`), the
`[[` completion, the node palette's add-tag, add-field and reference steps,
the ontology page's include/extends, the canvas's "add existing node" and the
tag page's add-field. A query matches fuzzily (prefix, substring, id, word
initials, a compact subsequence) and the matched letters are marked; with
nothing typed an option set keeps its own order, other fields offer the
session's recent picks and then the most used. The field picker shows what the
field holds checked; in a many-valued field Enter toggles and it stays open,
Backspace on an empty query takes back the last value, and in a one-valued
field a pick replaces and closes. Its last row creates the query as a node
where the field's declaration says a target goes (`refCreationOf`: an option
under the field, a node with the field's target tag, a top-level node) — never
for a query-constrained field. The list is anchored to its input, flipped and
clamped to the viewport (`useAnchoredPosition`), so a cell or a column never
clips it. The global ⌘K palette is a different gesture — search and open —
and keeps its own index.

**Named gaps.** A ref value's bullet follows on a plain click (a value's
bullet has no children of its own to expand) rather than expanding the
target's children inline under the field. `[[` completion is not offered while
editing a text value (a typed token still mentions). The date editor's Enter
commits without opening a next value, and its Tab does not move on. Pasting
several lines into a many-valued field is not split into values. The node
palette has no "Add value to …" command. `sys.f.color` keeps its always-open
swatch row. The PropValue union still carries the legacy `date` variant so old
stores decode (opening rewrites it). Table and board cells are not in the
arrow path (the outline's rows are).

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

**Scope filters content, never meaning.** A member's field and tag
definitions — field name, type, cardinality, hidden flag, option set, tag
name and template, the label of a ref value — are schema, and schema is
resolved against the whole graph whatever the scope. It is a type of its own:
`lib/schema.ts`'s `SchemaIndex`, which only `schemaOf` produces, and every
function that reads a definition takes one, so handing a schema reader the
projection (`NodeMap`) does not compile. A ref field's declared option set is
schema too, and its picker offers it whole; a ref field that declares no
targets is an open search, which is navigation, so it searches the outline as
shown. The ref editor decides both itself, from its field id and one
`FieldContext` (`fieldContextOf`: the schema, the outline and the index), in
`refSearchOf` (`lib/refs.ts`), so no surface computes an allowed set or can
forget to. The projection itself stays
members only, and resolves its rows' tag chips against the full snapshot.

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
  `resetCamera`, `focusNode` — `--motion-duration-follow` on the one ease
  (`lib/timing.ts`). Toolbar buttons plus
  `+`/`=`, `−`, `0`, `f`, `/`. Camera state survives data updates and theme
  switches, and a module-level positions cache keyed by layout restores a
  perspective's layout when you return to it.
- **Worker layout.** `fa2-layout.ts` runs ForceAtlas2 in a web worker with a
  2.5s auto-settle (`SETTLE_TIMEOUT_MS`), falling back to a synchronous
  rAF-chunked loop by feature detection.
- **Dragging a node runs the layout live**, in 2D and 3D alike: one gesture,
  `NodeDrag` in `lib/graph-drag.ts`, over a `DragLayout` port every layout
  implements. A press on a node suspends what else the pointer drives (the
  2D pan, the 3D orbit); past the pointer slop it is a drag, and a press
  that never passed it is a click (select, open) as before. While a node is
  held, a force layout pins it under the pointer and keeps running — 2D
  holds it as ForceAtlas2's `fixed`, 3D at d3's drag heat (alpha target
  0.3) — so its neighbours follow; the drop frees it, and the layout cools
  and stops (2D after an 800ms burst, 3D as alpha falls back to rest), so
  nothing draws after the settle. A placed layout (radial, hierarchical,
  grid, the cluster placement) only moves the held node. The dropped node is
  **not left pinned**: a graph view is a projection of the graph, and a pin
  would be view state with no node to live on and no gesture to undo it, and
  would bend the layout for good; the layout stays the truth, and a drag is
  a way to pull on it and watch what comes along. Where the pointer puts the
  node is the renderer's (`DragSurface`): sigma's camera inverted, its frame
  held at its extent during the drag so a node dragged outward does not
  rescale the view under the pointer; in 3D the camera holds still
  (`GraphCamera.hold`) and the node follows the pointer's ray on the plane
  through where it was grabbed, facing the eye (`force3d-drag.ts`). A 3D
  press is taken ahead of the orbit (a capture listener), the pressed node
  stays hovered so its neighbourhood stays lit, and the ambient turn waits
  while the pointer is on a node. `drag-layout.contract.test.ts` proves the
  port over every layout (2D force, placed, 3D force on the page and through
  its worker protocol), and the render suite drags through both force
  renderers' workers in a browser.
- **Search and filter compose.** The toolbar search (`/` focuses) does
  case-insensitive substring matching on labels, `Enter` cycles matches with an
  animated camera move; the collapsible tag legend isolates a colour bucket on
  click. The two intersect — a node must pass both to stay lit. Both are
  **ephemeral**: filters, search and selection never persist, while a renderer
  switch is a persisted prop write (`mutations.setLensRenderer`).
- **Directed, weighted edges.** A 2D edge is an arrow, straight or curved
  as the perspective's link style says (below); a curved pair of opposite
  links bows apart instead of overlapping. `graph-lens.ts` deduplicates
  parallel edges into a `weight` count, and stroke width scales as
  `√weight` (`linkWidth`, in the layout's units like the discs below) —
  repeated relationships read as thicker, single links are a hairline. (3D draws one-pixel links, so weight is not yet drawn there: a
  recorded gap.)
- **A 2D node is a disc in the layout's space.** Its radius is in the
  layout's own units, not in screen pixels (sigma's `itemSizesReference:
  "positions"`), so a disc and the spacing around it scale together with
  the viewport and the zoom: a small window or a zoom out never makes the
  nodes grow over each other. `graph-discs.ts` owns the relation, once:
  the lens size maps to a radius bounded against the layout's spacing
  (`discRadius`); the discs are separated (`separateDiscs`) after every
  write that changes the graph's shape or any disc's radius, by one rule,
  `DiscSettle` — by the force layout when it settles if it is still
  moving, at once otherwise, so a new size encoding on a still layout
  settles too; a placed layout (radial, hierarchical, grid) sets
  neighbours at least their radii apart (`discSpacing`, so a ring, column
  or cell grows to hold them); and the cluster placement packs each group
  as a sunflower stepped by its members' radii, so a hub's leaves ring it
  clear before any separation runs, and sets the groups on a ring just
  wide enough that every two of them stand their widths apart (two groups
  are one chord across it). `separateDiscs` is a bounded pass of
  noverlap, not a solver that always converges: from a badly overlapping
  start it can stop short, which is why every layout places its discs
  clear first and leaves it only the remainder. `graph-discs.test.ts` proves it after
  settle on the fixture graph and on a dense graph of hubs and leaves, in
  every 2D layout, for two and three unequal cluster groups before and
  after separation, and after a size change on a still one: no two discs
  overlap beyond a hair, and the
  largest radius stays under its stated bound.
- **Honest empty and large states.** Zero matches renders guidance rather than
  a blank canvas; invalid EDN surfaces an amber warning chip (`queryError` on
  the lens); a capped lens reports "top N of M nodes by degree" in the header's
  node count, beside an "edit max-nodes" jump to the perspective node, so the
  report stays in flow and never covers canvas chrome. Above
  `LARGE_GRAPH_THRESHOLD` = 1500 nodes the renderer degrades deliberately:
  `hideEdgesOnMove`, label threshold 12 (from 7), label density 0.5 (from 0.8).
- Cluster renderer: padded hulls with member-count labels, top-15 cluster cap,
  drag with live hull redraw, hull-click isolation. Tree renderer: pointer
  pan/zoom plus Fit / Collapse-all / Expand-all. A small forest (60 nodes
  or fewer) opens whole, a larger one two levels deep (deeper branches
  start folded); the fold belongs to the view (perspective, query, focus, sys
  switch, ontology), so a new view folds afresh while a store update keeps
  the user's fold and folds only the nodes it adds, each root's subtree runs left to
  right, and a forest of many roots is packed into columns in root order,
  as many as bring the packed shape nearest the frame's (`tree-layout.ts`),
  so a hundred roots fill the frame instead of one sliver.

#### Look and motion

The graph views apply the [Lab principles](#lab-principles); this says only
where each one lives. Everything below reads the tokens through
`useAppearance()`, so the three design systems in both variants each look
like themselves (P5).

- **One renderer contract.** Every renderer view the graph plugin provides
  promises the same things, and `renderer-contract.test.tsx` proves them over
  each one, drawn through a slot inside a graph frame as the page draws it:
  another renderer taking the frame leaves nothing of
  it behind; a renderer that copies token values out (a canvas, a GPU
  palette) reads them again when the appearance changes, while a DOM
  renderer paints live `var()`s and copies none; with a node selected, a
  hover never moves the focus — the one rule, `graphFocus` in
  `lib/graph-interaction.ts`, which every renderer asks. The suite's table
  must list exactly the provided renderer views, so a new renderer joins it; the 2D
  renderers need WebGL, and their rows wait on a named gap.
- **Emphasis eases, in every renderer.** What should be lit is one
  definition (`graph-interaction`, `graph-dim`); how it gets there is one
  mechanism, `lib/graph-fade.ts` (`EmphasisFade`): a hover's neighbourhood
  fades in over `--motion-duration-quick` and back out the same way, and
  a node in focus swells a little. 2D does it through `sigma-emphasis.ts`,
  which owns sigma's reducers; 3D through `force3d-emphasis.ts`. Sigma blends
  `ONE, ONE_MINUS_SRC_ALPHA`, so its colours are premultiplied
  (`premultipliedGraphColor`) — a straight-alpha colour drew faint links and
  dimmed nodes at full brightness.
- **A link at rest is one token**, `--graph-edge` (colour and alpha
  together, set per design system and variant), read by the 2D edges, the
  tree's links and the 3D links alike.
- **2D (force, cluster).** Arrow edges in the link style's shape; every node ringed in the
  ground colour (`@sigma/node-border`), in the ink when in focus (the
  bullet theme draws bullets instead, below); labels in the theme's label
  style over a halo of the ground (the default's is soft), their colours
  read once per appearance. A
  label sits right of its node, else left, else centred above or below it,
  and never over another label or a drawn node at least as well connected
  (a hub ringed by its leaves is named over a leaf), so crowded clusters
  thin their own labels; label density
  also falls with the square root of the node count past 400. Labels are
  placed in one priority, stated once in `lib/graph-label-layout.ts`
  (`byLabelPriority`) and used by 2D, cluster and 3D alike: the node in
  focus, then the best-connected, then by id — so a hub is labelled before
  the leaves around it, whatever order the renderer asks in. A cluster's
  title takes its place in the same layout before any node label, so titles
  never pile on each other or on labels, and labels come in only once the
  nodes they name have arrived — one threshold, `labelArrived` in
  `lib/graph-arrival.ts`, for 2D and 3D alike. A new
  graph arrives from its hubs, in 2D and 3D alike (`lib/graph-arrival.ts`):
  the best-connected nodes first, their neighbours one `--motion-stagger`
  per hop outward, each growing in over `--motion-duration-reveal`, so the
  whole graph has settled in 300–400ms while the layout settles (P2, M3). Cluster hulls
  are soft regions — a faint fill and a glow for an edge, in the cluster's
  colour — and the hull under the pointer comes forward.
- **Tree and treemap.** A layout change (collapse, expand, resize, a new
  encoding) glides on `--motion-duration-follow`; hover and emphasis fade on
  the quick duration; an arriving element fades in. One class,
  `.kb-graph-move` in `motion.css`, and a tree link's path (`d`) moves with
  its nodes. A tree hover lights its neighbourhood like a selection does.
- **3D** is drawn on the scene kit (`src/scene/`, see [The lab](#the-lab)):
  the same WebGPU + TSL stage, post chain, palette uniforms, frame loop and
  reveal as the studies (T1, P4) — `force3d-scene.ts` owns no renderer.
  Nodes are one instanced draw with the rig baked into the material; only
  the focused, hovered, searched-for and best-connected nodes glow past 1,
  so only they bloom (L2). Degree sets a quiet hierarchy: the top 3% of
  nodes by degree glow and stand a little larger, the next 10% are only a
  little brighter, the rest stay matte. Which light may cross 1 is
  enforced in the shader, not assumed of the palette: a node can carry any
  stored colour (a tag colour, a `sys.f.color` taken verbatim, any swatch
  hex), so its rest is capped at white, and the rising tier's and a focus's
  neighbours' light is a *lift* the shader caps at each fragment's own
  headroom under white; only a *glow* (focus, hover, a search match, a hub)
  may pass it. the light is written once (`shadeNode` in
  `force3d-light.ts`) over the scene kit's shading arithmetic, run as TSL
  nodes by the material and as numbers by `force3d-light.test.ts`, which checks
  it over the unit cube's corners, every pure channel and a seeded spread of
  colours, under every design system's ink in both variants. The scene's dress is its theme's (below); in the default theme, range fog follows the camera's distance, a
  restrained starfield stands at infinity, the backdrop is the page's own
  surface — the card at the focal point, falling to the background on a dark
  ground and to the muted surface on a light one, under a fine grain, so a
  light stage has a ground (P5) — and dither breaks banding (L3, L4); there is no tone mapping, so
  the tokens are reproduced exactly and the canvas meets the page. Links
  brighten from source to target, and particles run along the focused
  node's links only (M4). Select flies the camera to the node on critically
  damped springs (`force3d-flight.ts`, M1, M5), backing off until the
  node's whole 1-hop neighbourhood fits with margin; fit, zoom and search jumps
  fly the same way, and the camera follows the layout until the user takes
  it. The layout is d3-force-3d in a worker (`force3d-layout.ts`), with a
  faint pull to the centre so orphans do not shrink the frame. Frames are
  drawn only while something moves, the device pixel ratio is clamped to 2,
  a hidden tab draws nothing, and a renderer switch or unmount disposes the
  scene, its worker and its listeners (`force3d-graph.lifecycle.test.tsx`).
- **Graph themes** are data: a perspective's `lens.theme` is one of
  its option nodes (children of the field, like the renderers), picked in
  the settings panel and persisted as a ref prop. A theme is a whole scene,
  not a material: `graph-themes.ts` states each one once, as one record in
  two parts. The parts any renderer draws — what a node is drawn as (its
  `form`), how links take their colour and gradient, and the label's
  face, weight, case, halo and placement — are the theme's, and each
  renderer realises them in its own terms; the label is painted by one
  canvas painter wherever it is drawn (`lib/graph-label-paint.ts`), and a
  bullet from one GPU form (`lib/bullet-gpu.ts`). The 3D scene's dress —
  which tokens fill the ground and its edge, the backdrop's pool, warmth
  and haze, the fog, the starfield, the grain, the bloom (and so whether
  any light may cross white at all) and the node surface — is its
  `scene`, which only the 3D graph has. The 2D graphs (force and
  cluster) wear the theme too, through the same record: a solid form is
  drawn as the node's disc and the bullet form as the outline's bullet
  (below); labels are set in the theme's face, weight and case under its
  halo, still placed by the 2D label layout (beside first), so `placement`
  is the 3D label's anchor; links take the tone's strength and accent lean
  (`restingLink`, the one reading both renderers draw links from) but not
  its gradient, since a sigma link is one colour. What the themes are, and
  why, is below. Switching one redraws what it shapes
  in place: the palette eases across like a theme change, the stage's
  knobs move, the nodes and labels are redrawn; nothing moves, lays out or
  arrives again, and the link layer's motion is carried on.
  Every theme's node light runs through the one `shadeNode`: its surface,
  then the shared rest cap, lift cap and glow. A theme without bloom turns
  its glow into lift, so no fragment of it passes white, and its stage's
  bloom is zero. `force3d-light.test.ts` proves the bloom rule over every
  theme, every storable colour and every design system in both variants,
  on the ground that theme stands on: at rest and under any lift nothing
  passes white, a blooming theme's hubs do, and a theme without bloom
  never does. A surface must grow with the key and depend on the view only
  through the rim — what lets that proof find each sphere's brightest
  fragment ring by ring. Each form states where its fragments stand in
  (key, rim) — a sphere's rings, a cube's whole square (a face may meet
  the key squarely while its edge line is drawn), a bullet's one flat
  fragment — so the proof runs over what that theme's nodes can show. The scene contract and the renderer contract run
  the 3D graph in every theme.
- **The themes.** Each reads only the design system's tokens (L1), so it
  looks like itself in kb, paper and terminal, light and dark (P5):
  - *Matte* (the default) — the studio: the card's colour pooled at the
    focal point over the page, fine stars, range fog, a soft key and an
    ink rim, links brightening source to target, labels in the graph face
    on a soft halo of the ground. The quiet look the others are measured
    against.
  - *Cel* — ink on paper: a flat ground with no pool, stars or fog, the key
    in three hard bands under a heavy ink outline, links drawn as even ink
    strokes, bold labels on a ruled plate of the ground. No bloom: a graphic
    print does not glow; focus reads through the outline and the swell.
  - *Fresnel* — the night instrument: a pool falling away to the frame
    under a still haze, more and brighter stars, a quiet body under a
    bright grazing rim, links leaning toward the accent, labels in the
    monospace face, upper case and tracked, and the strongest bloom.
  - *Glass* — the aquarium: a faint warm pool of the accent and a soft
    haze, fog that starts close so depth reads, no stars; the ground seen
    through a tinted bead with a tight glint and a thin ink edge, faint
    links, and light labels on a frosted chip.
  - *Bullet* — the outline, in space. Every node is drawn as the outline
    draws its bullet, from the same definition: `lib/bullet-mode.ts` owns a
    bullet's appearance (kind, shape, glyph, halo, dot, ring, their paints
    and their geometry — box, dot, halo and ring sizes, the ring's stroke
    and dashes, the magnifier's lens and handle), and the outline's
    `Bullet` and the graph's GPU form of it (`lib/bullet-gpu.ts`) both
    read that record, so a change to the bullet changes both. A graph
    node's appearance is `outlineBulletAppearance` of the same outline node
    the editor renders — its kind, its children, its collapsed state, its
    tag colours through `tagPalette`. A bullet is drawn analytically: the
    shape is a handful of uniforms (`BULLET_UNIFORMS`: the ring, the
    magnifier, the glyph box, in px of the box), each node carries its
    mark, its halo and dot radii and where its colours sit in a small
    colour table (`BulletTable`: one row per distinct bullet — the page's
    ground and ink, the ring, then every tag's wedge of the halo and dot),
    and each fragment measures its signed distance to the marks and
    antialiases it over one screen pixel, laying the halo, ring, dot and
    ink over the ground in the outline's order. So a bullet is as sharp
    zoomed in as the outline's is, and nothing is painted per frame: the
    table is painted again only when some bullet or the page changes. The
    kind glyphs (# ⌗ ⚙ ▣ ◇ ⬡) are type, not geometry: they are set once in
    the UI face and read back as a signed distance field
    (`BulletGlyphs`, one cell per glyph, shared by every renderer for the
    session), which the same antialiasing draws, set again only when the
    face or its size changes or it finishes loading. A multi-channel field
    would keep a glyph's corners sharper under extreme zoom, but needs the
    glyph's outline, which a canvas does not give; a raster re-set to the
    zoom would be per-frame work. Each 3D node is one camera-facing
    sprite, one draw; the scene stays orbitable 3D. The ground is
    the page's plain background, the light is flat (the surface is the
    laid colour), there is no bloom, fog, stars or grain, links are even
    lines of `--graph-edge`, and labels sit right of their bullet in the UI
    face, as a row's text does. A bullet carries no lift or glow, so at rest
    each one looks as the outline's does whatever its degree; focus swells
    it, and a dimmed node sinks into the ground. Its halo spans twice the
    sphere the node would be in another theme, so its small dot reads, and
    it is picked, framed and labelled by as far as it shows
    (`bulletExtent`: its halo when it has one, else its dot or glyph). In
    2D the same GPU form is drawn by a sigma node program
    (`sigma-bullets.ts`, one instanced quad per node), and a bullet
    stands exactly as far as its disc — its halo, else its dot or glyph —
    so the disc rules above (separation, picking, label clearance) hold
    unchanged and a plain leaf is the disc it always was; a dimmed bullet
    fades as a disc does.
  - *Cube* — the model on the bench. Every node is a cube of its colour
    (`SOLIDS` in `force3d-nodes.ts`: the solid layer is one instanced
    draw whatever the solid, and a theme's `form` picks it), holding the
    volume of the sphere it replaces, so it is picked, framed and
    labelled by the same radius and sizes compare across themes. Every
    cube is set once in the isometric attitude, a corner toward the
    default eye, so three faces show and each takes the key differently;
    it does not turn, because a moving cube would keep the stage drawing
    and one shared attitude lets light, not angle, carry the hierarchy.
    Its rim is a face's grazing rim or a thin line along each edge, so the
    matte surface draws the silhouette and every edge in the ink. The
    card's pool under a faint warm haze, range fog, a few stars on dark,
    a restrained bloom, even links, labels in a firmer weight of the
    graph face. In 2D a cube is the node's disc.
- **Link styles** are one choice for both renderers: a perspective's
  `lens.link-style` is one of its option nodes — *straight* (the default),
  *curved*, *flow* — and `graph-link-styles.ts` states what each one means
  as two parts, its shape (straight or curved) and its motion (still, or
  dashes drifting source to target, one passing in the ambient period,
  still under reduced motion). Flow is drawn on curves. The renderers that
  draw the graph's links (2D, cluster and 3D; the tree draws its own
  elbows) read the shape; only the 3D graph can move a dash, so the 2D
  graphs draw flow as its shape, still, and the settings panel says so.
  Switching one redraws only the links (and the particles, which follow the
  curve), in place and carrying their motion.
- **Reduced motion (M7)** everywhere: fades and flights cut, the 3D layout
  settles unseen and posts once (and so does each move of a node drag, the
  layout at rest around where the node now stands), particles and the ambient turn stop, and
  the DOM renderers' transitions are flattened by the global rule.

Not shipped, named: the settings popover (the FA2 live-layout API is wired but
has no UI), a committed perf fixture, picker keyboard nav, weight-scaled 3D
links.

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
- **Direct-manipulation invariants.** A 4px pointer slop (`POINTER_SLOP` in
  `lib/pointer-slop.ts`, the one slop the scene kit's taps and a graph node's
  drag use too) kills hair-trigger moves, pointer capture on card drags and resize handles survives a fast drag,
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
- **Floating selection toolbar** with Delete / Bring-to-front / Send-to-back.
  Items paint by depth (`z`), then in document order, and the two buttons
  reorder the document (`paintOrder`, DESIGN.md → Canvas documents).

#### Projections

A canvas is drawn through one camera model, `lib/canvas-camera.ts`: a view
is a focus point in canvas space, a zoom measured on the plane through that
focus, an orbit (`yaw`, `pitch`) and a field of view, where `fov` 0 is
orthographic. The DOM canvas is that camera face-on and orthographic, which
is exactly its CSS `translate(pan) scale(zoom)`; `viewOfPan` and `panOfView`
are the bridge, and zoom-to-fit, client-to-canvas conversion and the edge
drop target (`hitTest`: the nearest item under the ray, each on its paint
plane, `paintPlanes`: its depth raised a hair per earlier item at that depth,
so paint order decides from the front and nothing ever ties) all go through
the camera rather than through pan
arithmetic or `elementFromPoint`. A gesture reaches the pointer reducer as a
screen point, which decides slop and panning, and the canvas point it stands
for, which decides where a moved or resized card goes.

Two projections hold that camera (`CANVAS_PROJECTIONS`,
`components/canvas/canvas-projections.ts`): **2D**, face-on and
orthographic, drawn as DOM cards over SVG edges; and **3D**, in perspective
and orbiting its focus, drawn on the scene kit's stage
(`components/canvas/canvas-scene.ts` and its card and edge layers, the
canvas's only three modules, loaded in their own chunk; the harness's
`components/canvas/3d` zone is the only part of the canvas that may reach the
scene kit). A projection declares only how it holds the camera
(`settle`) and the view it opens at when it takes over (`arrive`: the saved
pose, or the same focus and zoom tipped back like a desk). The document's
`camera` names the projection a canvas opens in and its last 3D pose
(DESIGN.md → Canvas documents); the toolbar's 2D/3D toggle writes it, the
undo history leaves it alone, and an agent that writes it switches every
open view of that canvas.

- **One contract.** `canvas-projection.contract.test.tsx` runs one suite over
  every registered projection: each draws every item once in paint order and
  every edge whose ends exist, marks exactly the shared selection, draws
  every item's corners where the camera model projects them on its paint
  plane, draws on top at a point what `hitTest` finds there (the DOM's
  topmost box; the nearest drawn plane), and draws a moved card where it
  moved — from a desk tilt, an oblique orbit and from behind, with raised,
  sunk and same-depth overlapping cards. The 3D scene also joins the scene
  contract, whose disposal check covers every geometry and material a scene
  drew with.
- **One camera in motion.** `lib/canvas-camera-rig.ts` holds the view the 3D
  scene draws with: gestures move it at once, flights ease over
  `--motion-duration-arrive` on `--motion-settle`, and under reduced motion
  a flight lands at once. The keymap's zoom and fit reach whichever camera is
  showing through `CanvasViewportControls`.
- **The handover** (`canvas-handover.ts`): into 3D, the rig stands where the
  2D view is, the scene mounts behind the DOM canvas, the two crossfade
  while they are identical (`--motion-duration-reveal`), and then the field of
  view opens at a fixed zoom — a dolly zoom out of orthographic. Back to 2D
  the rig flies face-on first and the DOM canvas takes its pan and zoom on
  arrival. A scene that cannot start leaves the canvas in 2D for the visit.
- **Cards stay cards.** Each card's face is painted into a canvas texture as
  it looks in 2D (`canvas-card-face.ts`): its text in the UI face at the body
  step, its bullet and tag chips, its shape and preset colour, the selection
  ring. A face is repainted only when what it shows changes; a resized card
  keeps its face stretched until sizes hold still, faces painted before the
  page's fonts arrived are repainted once they do, and texture density
  follows the display's pixel ratio up to a cap. Edges are rebuilt only when
  what they are drawn from changes. Translucent colours are composited over
  the face in sRGB before
  upload, because the GPU blends in linear light and would thin a faint
  hairline and brighten a faint wash. A raised card casts a soft shadow on
  the canvas plane, which carries the 2D dot grid; edges are lines between
  side anchors climbing from one depth to the other. The ground is the
  page's, edge to edge, so the crossfade is between equal grounds.
  Three stays at r180: r186's `HTMLTexture` needs Chrome's HTML-in-Canvas
  origin trial (`copyElementImageToTexture`) and silently draws nothing
  without it, so it would ride on this path as a second one rather than
  replace it.
- **Gestures in 3D** are the 2D ones where they mean the same: a press on a
  card selects it (a modifier toggles), a drag carries it on its own plane
  and Alt-drag lifts it. Both are the pointer reducer's one move, carried
  across the plane or along depth (`CARRY`: whole units at the current zoom
  for depth), and both are history steps written through `ext.canvas.tx.apply`.
  A drag on empty canvas orbits, a tap places the current tool on the plane
  (or clears the selection), the right or middle button or Space pans, the
  wheel pans and a pinch zooms about the cursor (`canvas-scene-gestures.ts`).
  A card let go where its plane is edge-on stays where the drag last had it,
  and a tap that moved no camera saves no pose; a pose equal to the saved one
  is not written again. Text is edited in 2D; edge labels and resize handles
  are 2D only. Texture memory and culling for very large canvases are not
  built (`GAP [[01M3S5DDC3JYX8871YMJ7C6PAN]]`).

Not shipped, named: cursor-centred scroll zoom (zoom is viewport-centred),
real Clipboard-API copy/paste, snap guides during keyboard nudge, edge colour
on the stroke itself, edge endpoint re-routing, group cards translating their
children.

### Cross-surface polish (i5)

The rules that hold everywhere, so no surface re-invents them:

- **One captured global shortcut.** `lib/keyboard-shortcuts.ts`
  `matchGlobalShortcut` owns ⌘/Ctrl-K and nothing else: `"node-palette"` when
  an outline row anchors it (selected or edited), `"global-search"` otherwise
  — ⌘S is deliberately left to the browser, because kb has no save action to
  bind it to. App-level dispatch lives in `components/App.tsx`. Zooming never
  leaves the selection on the zoom root, which is a header and not a row: it
  moves to the first row under it, or clears.
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
- **Focus follows the selection.** A `NodeRow` that becomes selected takes
  focus when it would otherwise fall to `<body>` or is still inside the row
  (Escape out of its editor), never from anything else. The first Tab stop is
  a "Skip to content" link past the sidebar to the main column.
- Navigation affordances are keyboard-reachable: sidebar Home exits zoom, a
  closed sidebar is inert with focus returned to its toggle, breadcrumbs carry
  an accessible label and current-page marker, and tag chips expose real
  navigate / remove / configure buttons instead of click-only regions.

Deferred from i5 and still open: view-settings
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

### UI points: routes and views

The UI is assembled from contributions to the browser's `@kb/plugin` kernel
(`lib/plugins.ts`), and four points hold them: `RoutePoint`, `ViewPoint`,
`SidebarSectionPoint` and `DockPoint`. This section is the one statement of
the first two; [Docks](#docks) states the last.
The plan they come from is
`docs/kb/waves/2026-09-24/briefs/plugin-composition.md`, and this is its
phase R1.

**A view is the concept, and a page is a route to a view.** A graph page and
an ontology that shows the graph are one thing: a projection of the graph,
rendered in a box the host owns. So there is one point for it, and routing is
a separate point that only points at it.

- **`ViewPoint`** (`ui.views`) holds a `View<P>`: its `key`, the `placements`
  it can fill, a `sample: P` (the params the contract suite mounts it with),
  and `Component`, which receives `{ params: P, host: ViewHost }`. A view owns
  no route and no chrome.
- **`RoutePoint`** (`ui.routes`) holds a route: the `view` key it renders,
  `match(path) → P | null`, and, from those params, the shell `frame`
  (`scroll`, `fixed` or `full`), the `pendingTitle`, and an optional `Chrome`
  (a bar the shell renders outside the scroll region, such as the ontology
  scope bar). A route owns no page component. The shell resolves the path to
  the first route that matches, then renders that route's view through a
  `<ViewSlot>` at placement `page`. A path that no route owns is not found.
- **`ViewHost`** is what a host guarantees a view. It is never a store and
  never `ctx`. It carries only `placement`, which is `page` (the view fills
  the box its host gives it: the shell's page, the graph's canvas) or
  `inline` (the view sits in the outline's flow, under the row of the frame
  it shows). The rest of the host contract (size, appearance, reduced motion,
  and the other placements) arrives with its first consumer
  (GAP [[01M3EZR20H0CDF5MD01M2S26C5]]). Nesting is separate from placement,
  and it is already live: the ontology's view embeds the graph and outline
  views, each in a page-placed slot inside the shell's page slot, and the
  outline shows each frame's children in an inline slot. The slot owns the
  depth guard (promise 6).

**Keys.** A `ViewKey<P>` is made once, by `viewKey("<namespace>.<local>", params)`,
and is compared **by identity**, like `Service`, `Event` and `Point` keys. A
key with the same id that was created somewhere else is a different key.
`params` is an Effect `Schema` decoder of `P`: the view's settings, stated
once. It is what types `P` for the compiler, and it is read at run time: a
host decodes the view's stored config through it (`paramsFrom`, which keeps
only the settings the key declares), a settings panel asks it which settings
the view reads, and the contract decodes each view's `sample` with it. A view
that renders from the store alone declares `NoParams`. A key also names the
view in data: `option` is the id of the option node that stands for it in
the store (`sys.view.<id>`, derived from the id, so the two cannot disagree),
and `config.read(props, host, report)` reads stored props into the input
`params` decodes (`paramsFromProps`), for the node the view is shown for;
`config.write` is its inverse (DESIGN.md → View nodes). A frame view reads
the `sys.f.view.*` settings, a renderer the lens props, and a view whose
settings nothing stores reads nothing.
`provideView(key, view)` builds the
contribution under the key's local id, and `provideRoute(route)` builds a
route under its view's local id. A plugin's namespace is therefore the key's
namespace, and a view contributed under any other id cannot be found by its
key, which the contract suite reports.

**Asking.** `useView(key)` returns the `View<P>` provided under the key's id
only when that contribution's key is this very key object. That identity
check is the one place an erased view is read as `View<P>`, and it is the
same trust `asKeyType` spends in the kernel. `paramsOf(route, key)` reads a
matched route the same way: it returns the route's `P` when the route renders
this key, and `null` otherwise. A sidebar section uses it to know whether the
current page is its own, without naming an id as a string.

**The slot's promises.** `<ViewSlot view params placement fallback subject?
pending?>` is the only way to render a view, both for the shell's page and
for one plugin embedding another's view. `subject` is what the host shows the
view for (a frame's id, a perspective's), where it may show the same view for
another.

1. It renders the view provided under `view`, with `params` and
   `host = { placement }`.
2. It renders `fallback` when no view is provided under that key, when the
   one there was made with a different key object, or when the view does not
   offer `placement`. `fallback` is a required element, so a slot never
   renders nothing. This is live: unloading the owning plugin switches the
   slot to its fallback, and reloading it brings the view back.
3. It wraps the view in its own `ViewErrorBoundary`, reset by the key's id
   and the `subject`. A view that throws shows `ViewError` in its own box,
   and the host around it stays up.
4. It wraps the view in its own `Suspense`, showing `pending` in its box
   while the view's code or data loads (by default a quiet token-coloured
   placeholder; the shell's page passes its own loading state), so a host
   that embeds a lazy view never blanks a boundary above it. A load that
   fails and knows how to be tried again (`RetryableError`, from
   `lib/kept-load`) is told so by the boundary's "Try again".
5. It adds no DOM of its own, so the box is exactly what the host gives it.
6. It knows the slots around it, outermost first, as a chain of links
   (`SlotChain`: each slot's view and subject), through a React context that
   only the slot writes, and renders only when `slotRenders` says so
   (`lib/view-key.ts`): not when any slot around it shows the same view for
   the same subject, which is a cycle however many other views lie between,
   and not past `MAX_VIEW_DEPTH` (32), a safety net against runaway nesting
   of ever-new subjects. A list's rows each showing their frame as a list
   are links for other subjects, so they are no cycle. A view that embeds
   itself, directly or through another view, stops at the first repeat. The
   chain is the slot's to keep; it is not part of `ViewHost`, because no view
   reads it. The keyboard walk asks the same rule of the chain it walks,
   starting from the chain around the outline's root frame, which the outline
   host hands the store, so it never offers a row a slot refused to render.

**Views are soft and services are hard.** A missing view never makes its
consumer `pending`. The consumer shows the fallback. A computation that
another plugin must have is a `Service`, injected in `inject`, and it makes
the consumer pending while its provider is off. Use that form only when a
hard dependency is what you mean.

**Where keys live.** Every view key kb provides, with its param types and the
settings it reads from a view node, is data in `@kb/views`
(`packages/domain/views`, `scope:shared`), one module per plugin namespace,
with no React and no store. The server holds the same keys, to list, check
and render views (DESIGN.md → View nodes), so a key is never written twice.
Any zone may import the package. A host imports the key and never the
component. That is how the ontology embeds the graph and the outline
(`components/ontology/surfaces.tsx`) without importing either one.

**Families of views.** Some views are alternatives a host chooses between by
config. A family's key extends `ViewKey` under a discriminant, `family`
(`graph.renderer`, `outline.frame`), with what that host must know before it
renders one; keys are data (`@kb/views` knows no kernel, React or
store). How a picker names a view (`picker`: its label, its `order` among the
family, and where the family has them a glyph, an icon and a `sys.command`
node) is presentation, so it is part of the view's contribution, not of its
key; `provideView` requires it for a key with a `family`, and takes none
for a key without. A family is enumerated one way: `familyViews` over `ViewPoint`, which
keeps the views of that family that are provided, in `picker.order`. While
config is text, a view goes by its key's local id (`localIdOf`), which is
how the stored name resolves to the key among them.

- *Graph renderers.* Each renderer is a view whose `RendererKey`
  (`@kb/views`, `graph.ts`) adds its capabilities, encodings and whether
  it moves links. Its params are a `Schema.Struct` of the `LENS_SETTINGS` it
  draws with, so the settings panel enables exactly the settings its params
  declare. A graph view node's `sys.f.view` names it by its key's `option`
  (a neighbourhood's `lens.renderer` names the renderer it hosts the same
  way); the renderer switch lists the renderer views provided. The graph page decodes the perspective through the
  renderer's params and draws it through a `<ViewSlot>`. What the renderer
  draws from beyond its settings (the extracted graph, selection, camera and
  search) is not config, so it travels in the page's `GraphFrame` context,
  never in the params; a renderer view outside a graph host says there is
  nothing to draw. The graph page is one graph host, and a node's
  neighbourhood (`graph.neighbourhood`, below) is another. The renderers' components load in their own chunk,
  prefetched when the graph page loads; a renderer view suspends in its own
  slot until the chunk arrives, and a failed load is tried again from that
  slot's error.
- *Frame views.* A frame's children are shown by one of the outline's four
  frame views, list, table, board and cards, each a view at placement
  `inline` that the outline plugin provides. Their keys
  (`@kb/views`, `outline.ts`) carry the one trait the row walk needs
  beside the params: how the view lays rows out (`outline`, nested; `rows`;
  `columns`). The frame's first frame view node (DESIGN.md → View nodes)
  names the view, and `frameViewOf` (`lib/view-config.ts`) looks that node
  up in the schema, resolves its view among the frame views provided, falling
  back to the list's, and decodes the view node's props through that
  view's params, so the view gets exactly the settings it reads; a host
  that already selected the view node from the store (`useFrameView`) hands
  it to `frameViewThrough`, the same resolution without the lookup. What
  `frameRows` does with the rows follows from the params: every view
  filters, and a view sorts, groups its columns by a field, or pages exactly
  when its params declare `sort`, `groupFieldId` or `pagesize`. The
  toolbar, the node menu and the `view-as` commands list the provided frame
  views by their pickers, and every one of them, the toolbar's settings
  included, writes the frame's view node (`planEditFrameView`), making it on
  the first edit; none writes the frame's own props. A view node is edited
  as a row with fields, like any node, where it is filed. A view node is
  one node however many hosts name it, so editing it — from any host's
  toolbar or its own row — edits it for every host that names it; a host
  that should differ names a view node of its own.
  The store's row walk (`visible-instances`) and the command registry read
  the same enumeration through a port (`stores/frame-views`) that the
  outline plugin wires to `ViewPoint` while it is loaded, so the store never
  reads the kernel. The frame a view shows (its id, instance key, query rows
  and depth) is not config, so it travels in the host's `FrameSubject`
  context. Every outline host (the outline's root, a row of the list, a
  query's projected results) renders a frame view through `FrameViewSlot`,
  with the frame's id as the slot's `subject`, so a list of lists is a chain
  of links for other frames, never a cycle (promise 6). A query's results
  in the list view are the one rows
  the list draws itself, as references, through the query row's
  `renderNode`.

**The contract.** `src/view-contract.test.tsx` runs over every view that the
built-in and optional UI plugins contribute. A new view joins it by being
registered. For each view the view must: be found by its key; have a
`sample` that its key's `params` decodes; mount in a slot with its `sample`,
in each placement it offers, and show neither the fallback nor the slot's
error (a family's view outside its host shows its own empty state: no graph,
or no frame); show the fallback while its owner is unloaded
and come back when the owner reloads; have a throw from a provider under its
key contained by the slot; stop at the first repeat when a provider under
its key embeds that key again; and, once settled, leave nothing behind in its
box or elsewhere in the document when it unmounts. "Comes back" means
settled, with neither the fallback, a suspended state, nor an error showing.
The route table in `ui-plugins.test.ts` also checks that every route renders
a registered view that offers `page`. The slot is checked on its own too: a
view shown again down its own tree for other subjects renders up to
`MAX_VIEW_DEPTH`; a cycle through another view stops at its first repeat; a
view that suspends waits in its own box; and a view whose code failed to
load loads again when its error is retried. The remaining properties (sizing,
disposal of instrumented resources, appearance, reduced motion and bad
config) are deferred with the host contract, in the same gap as above.

**Decisions.** These are the defaults R1 takes for the brief's open
questions. Each one can be overridden.

1. *Name.* The concept is called **view** (`ViewPoint`, `ViewKey`,
   `ViewSlot`). "Lens" already means a graph perspective, and "embed" names
   the consumer's act, not the thing. The overlap with the outline's
   `sys.f.view.*` prefix is accepted: those modes are views now
   (Families of views).
2. *Where built-in keys live.* In `@kb/views`, as above: the package split
   this decision anticipated, made so the server holds the same keys. A key
   is data, so the package never pulls in the kernel, React or a store.
3. *Which nodes get embeds.* Per-node refs only (`sys.f.views`), decided in
   A1; DESIGN.md → Kinds, roles and options → View nodes.
4. *Neighbourhood direction.* The union of both directions, decided in A1;
   stated in the same section.
5. *Isolation.* Views are trusted and run in the same realm. Each one is
   contained by its slot's error boundary and its fallback. There is no
   iframe and no sandbox; that transport stays a later option for untrusted
   views.

**View nodes (A1).** A view someone chose is a node (DESIGN.md → Kinds,
roles and options → View nodes): its `sys.f.view` names the key whose
`option` it is (`viewKeyOfNode`), and its props are that view's params for
the node it is shown for (`paramsFromProps`). A code caller's params are
checked by `tsc`; nothing decodes them at the slot.

- *`graph.neighbourhood`* (graph plugin; `inline`, `page`) draws the
  neighbourhood of `root` — the nodes within `hops` of it along `edges`,
  either way — by hosting a renderer view the way the graph page does: it
  extracts the graph (`extractNeighbourhood`, the page's extraction over
  that node set), provides the `GraphFrame`, and draws the renderer named by
  `renderer` with `settings` in a page-placed slot filling its box, for
  `root`. Stored, its root is `lens.focus`, else the node it is shown for.
- *`outline.snippet`* (outline plugin; `inline`) is a read-only glimpse of
  the outline under `root`: its text, then descendants `depth` levels down,
  at most `maxRows` rows. Stored, its root is `lens.focus`, else the node it
  is shown for.

These points live in `@kb/ui`, not in `@kb/ui-sdk`; moving them is R2
(GAP [[01M3EZRFTS1W8SB97GFJAWD92X]]).

### Docks

A dock is chrome, like a sidebar section, not a view. It is a tool window
at the workspace's right edge, beside every page, and it shows no
projection of the graph. A plugin contributes it to `DockPoint`
(`ui.docks`) as `{order, label, icon, Component}`. The shell (`src/docks.tsx`)
draws one toggle per dock in the workspace header, in `order`, and the open
dock in the row beside the page. At most one dock is open (`openDock` in the
ui store, transient). Below 768px the open dock floats over the page, as the
sidebar does. Unloading the plugin removes its toggle and its window.

The first dock is the agent's chat (`components/agent`), the optional `agent`
plugin. It draws the conversation the agent channel reports
(`DESIGN.md` → Agent packages): the text as it streams, each tool call as a
line that opens onto its input and receipt, a running turn's stop button, and
a "new conversation" button that forgets the old one.

**Approval** is drawn as a card that waits on a call whose action requires
approval. Approve and Decline are both the same call, made by this tab
through the browser's one invoke path (`invokeSettled`), with `approved` set
to the person's answer. The receipt that comes back is what the agent is
told. A decline is therefore refused by the invoke core with
`approval_required`, exactly as an unapproved call from anywhere would be.
The folder reaches neither the socket nor the invoke path itself: the shell
binds them as its ports (`src/agent.ts`).

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
- Unloading closes the plugin's scope, so its routes, views and sidebar
  section leave the kernel and every `useContributions` reader re-renders
  without a reload. A slot that embedded one of its views shows its fallback. A path the plugin owned then resolves like any unmatched path: it
  is not found (`components/ui/not-found.tsx`).
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

Seven studies, each with a collapsible info card naming its technique, the
principles below it applies, and two to four live parameters:

| study  | technique                                                        | parameters                          |
| ------ | ---------------------------------------------------------------- | ----------------------------------- |
| Embers | TSL compute: a GPU spatial hash grid, contact heat, pops; bloom; four looks over one heat curve (glow, toon with an inverted-hull outline, ridged-noise molten, thin-film interference); heat haze and ash | look, heat gain, cooling rate, pop threshold |
| Sky    | a sun that lights the moon (terminator, phase and earthshine follow where they stand), node stars in a 3D volume (parallax), a domain-warped nebula, orbit controls; four-point glints, dither | glint length, nebula, earthshine, dither |
| Glass  | sphere tracing a signed distance field: smooth-min metaballs, normals from the gradient, Fresnel, refraction traced through the glass, per-channel dispersion, Beer–Lambert absorption, a studio of light strips and ink cards | blend, index, dispersion, absorption |
| River  | a GPU curl-noise flow field: 131 072 particles advected by one TSL compute kernel (divergence-free swirl, a meandering current, a pointer vortex, recycling), drawn as velocity-aligned streak sprites | current, eddy scale, turbulence, streak |
| Ocean  | Gerstner waves (steepness summed to at most 1), the analytic normal and a Jacobian foam mask, one sky function read by the dome, the reflections and the distance haze; Fresnel, a subsurface cheat, an HDR glitter path | waves, wavelength, sun height, foam |
| Light  | key/fill/rim rig, soft shadows, GTAO, tone mapping, finishes     | tone mapping, PBR/matcap, AO, key angle |
| Motion | staggered critically damped springs against an eased tween        | settle, stagger, drive, overlap     |

Embers keeps its theme rather than forcing a dark stage: on a light ground
the heat ramp moves from the emissive into the surface (`heatAlbedo`: pale
ash warming through the accent's ember to the accent), and only the hot
end's emissive still blooms. A forced dark stage would paint colours no
light-theme `--lab-*` token names (L1); the ramp makes both themes
intentional (P5).

Every study is built from one kit (P4), in two homes. What any real-time 3D
view needs is the **scene kit**, `src/scene/` (its own zone in `UI_ALLOWS`,
open to the lab and the graph): `host` (`SceneHandle`, the one interface
every mounted scene meets — sized, paused while the tab is hidden, told of
reduced motion, disposed — and `attachScene`, the one non-React mechanism
that keeps a scene in step with its element and disposes one whose mount
lands after the element has gone; each surface wraps it in a thin React
host of its own, so `scene/` holds no React), `gpu/screen` (`toScreen`, the
one projection of a world point to canvas pixels, decided in view space;
every label, pick and hover asks it), `gpu/pointer` (`PointerField`: where
the pointer is over a scene, where its ray meets a plane, and which presses
were taps — every study and the 3D graph read the one field), `gpu/stage` (renderer, post chain, tone
mapping, palette uniforms, frame loop, reveal), `gpu/tsl` (the typed TSL seam
and the ease as a shader function), `gpu/rig` (lights and finishes),
`gpu/backdrop` (every view's ground, through the stage's `backdrop()`: the
ground pooled at a focal point and falling to the edge colour, plus the
warmth, domain-warped haze and heat shimmer a study asks for — never a flat
fill), `gpu/starfield`, `gpu/dispose`, `palette` (the five palette roles, filled
from whichever tokens the caller names), `sphere` (seeded places on a
sphere) and `shade-ops` (the arithmetic a shading formula is written over
once, run as TSL nodes through `gpu/tsl`'s `NODE_OPS` and as numbers through
`NUMBER_OPS`, so a test proves the shader itself: Embers' heat curve and the
3D graph's node light). The timing vocabulary (the motion tokens, springs, eases) is
`lib/timing.ts`, beside `lib/motion.ts`, because DOM motion reads it too.
What only the lab needs stays in `components/lab/kit`: `study`
(`mountStudy`: a study's side of `mountScene`, and the theme hand-off), `palette` (the
`--lab-*` roles), `pan`, `pan-control` and `velocity` (drag-to-turn with
momentum, the pointer's smoothed speed; a press is a pan or a grab of what
it landed on), `orbit` (the pan read as a bearing round a target, plus a
dolly and eased flights), `entrance`
(a study's pieces arriving over the arrive duration, staggered by a lag the
study chooses; already arrived under reduced motion), `seeded` (the one
seeded random a study scatters from), `scene-host` (its React wrapper over
`attachScene`) and `info-card`.
`three` loads only in a chunk of its own: each study's scene and the 3D
graph sit behind a dynamic `import()` inside their surface's own lazy route
chunk, so every path from the entry to a three import, direct or through
`scene/gpu/`, crosses two of them. That is one
rule over the import graph (`UI_LAZY_ONLY` in `harness/src/constraints.ts`,
applied by the harness's `ui-lazy-fence` check), so no surface lists which of
its files may import three.

**The scene contract.** A lab study and the 3D graph are implementations of
one `SceneHandle`, and each is built through the stage's `mountScene`, which
answers the handle from the stage. What the handle promises belongs to the
handle, and one contract suite (`scene/scene-contract.test.ts`) proves it over
every registered scene — each study in `LAB_STUDIES`, the 3D graph and the
3D canvas:
disposing leaves no live renderer, loop or canvas; a hidden scene draws
nothing; under reduced motion no animation loop runs, and a change draws one
still frame (M7); the device pixel ratio never exceeds 2 (P3); a scene whose
build or reveal fails gives its stage back. The loop that keeps these is the
stage's: it runs while the scene is visible, motion is not reduced, and the
scene's frame reports that something still moves, so a study (always moving)
and the graph (moving while it lays out, flies or fades) share one rule.
Shadows (`StageOptions.shadows`) and ambient occlusion (`ao`) are decided
once, when the stage is built; the rig casts shadows exactly on a stage that
has them.

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
  frame-rate-independent approach (`1 - exp(-k·dt)`, `lib/timing.ts`
  `approachShare`, the one place it is written).
- **M2.** dt is clamped, so a tab switch never causes a jump.
- **M3.** Momentum and follow-through: drags carry inertia and decay;
  secondary elements lag the primary (overlap); stagger is small and
  consistent.
- **M4.** One hero motion at a time. Ambient motion is slow (periods of 8s or
  more) and small.
- **M5.** A visible reaction on the next frame, full settle in roughly
  300–600ms.
- **M6.** One timing vocabulary: durations, the ease and spring settle times
  come from the `motion.css` tokens (`lib/timing.ts` reads them; its fallback
  mirror is checked against the stylesheet), never retyped per study.
- **M7.** `prefers-reduced-motion` gives a still composition or a crossfade,
  never a half-animation.

**Light and colour**

- **L1.** A limited palette: one hue family and one accent, from the
  `--lab-*` tokens (the accent is `--primary`) through `lib/css-color.ts`.
  Value contrast over hue contrast.
- **L2.** Physically plausible light: a named key/fill/rim rig, a set tone
  mapping (ACES by default; AgX greys a light ground), sRGB output. Bloom's
  threshold is 1 (`BLOOM_THRESHOLD` in `scene/shade-ops`), so only HDR values
  glow and nothing glows by accident.
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
  typed seam is `scene/gpu/tsl.ts`. Plain CPU arithmetic that feeds instance data
  (the Motion field's springs) is not a shader and stays TypeScript. TypeGPU
  or raw WGSL only where TSL cannot express the thing, recorded as a gap.

Enforcement is honest, and split across two `#rule` nodes. The measured
bounds — the timing mirror and the principle bounds on the timing tokens
(follow 300–600ms, ambient period 8s+), the Embers pop budget, and T1's
fallback (each study on WebGL2 without WebGPU, or saying why it cannot
start, in the render suite) — are tests; the lazy three chunk is the
harness's fence above. Everything else here is prose, and its rule says so.

## Design tokens

A whole design system (colour, type, faces, weights, radius, elevation,
border width, density) can be swapped by redefining one set of custom
properties. Components never carry a raw value, so nothing has to be edited
beside that set.

### Layers

| layer | file | holds | may name |
|---|---|---|---|
| 1. design system | `ui/src/design-system.css` (the default), `ui/src/design-systems/<id>.css` (the others) | the values a skin chooses, as plain custom properties, with the colour overrides for dark | values only |
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

### Design systems

A design system is one complete set of layer-1 values, with a light and a
dark variant. Three ship:

| id | character |
|---|---|
| `kb` (default) | the nxus palette: neutral grounds, a warm amber accent, Inter, 8px corners |
| `paper` | warm off-white and ink, an ink-blue accent; the platform serif (`ui-serif`, New York on macOS, so nothing is downloaded); 5px corners, 0.5px hairline borders, soft low shadows, density 1.08. Dark is warm charcoal |
| `terminal` | dark-first phosphor green on near-black; one monospace face throughout, a type scale half a step smaller to suit it; 4px corners, density 0.875, and elevation drawn as an accent outline and glow rather than a cast shadow. Light is green ink on white |

**The mechanism.** `<html data-theme="<id>">` picks the system, and the
`.dark` class picks its variant, as it always has. The default is layer 1
itself: `design-system.css` declares its values on `:root, [data-theme="kb"]`
and its dark set on `.dark, .dark [data-theme="kb"]`. Every other system is
one stylesheet, `design-systems/<id>.css`, holding exactly two blocks:

```css
[data-theme="paper"] { /* every layer-1 value: base and light colours */ }
.dark[data-theme="paper"],
.dark [data-theme="paper"] { /* the colours the default varies in dark */ }
```

`index.css` imports each one after `design-system.css`, so a system's base
block beats `.dark` (equal specificity, later source) and its dark block
beats both (higher specificity). The selectors are attributes, not
`html[…]`, so the same blocks paint any subtree that carries the attribute:
the preference picker's swatches are live samples of each system, not
pictures of it.

**The preference.** `designSystem` sits in `kb-prefs` beside `theme` and
`width` (`stores/prefs.store.ts`). `applyPrefs` writes it to `<html>`, and
the blocking script in `index.html` writes it before first paint, as it does
the `.dark` class, so there is no flash. A stored id without a stylesheet
paints as the default, and the store corrects it on boot. It is chosen in
Preferences → design (one live swatch per system) or by the palette's
*Switch design system* command (`sys.cmd.switch-design-system`), which steps
through the registry. Switching crossfades like a theme change.

The UI face used to be a preference of its own (`font`: Inter or Outfit).
A face is a design-system value, and a second control over one token would
have been a second skin mechanism beside the first, with combinations no
guard covers, so it was folded in: a stored `font` is ignored and dropped on
the next write.

**Canvas and WebGL** re-read on the one appearance signal (see Radius,
borders, faces, colour → *Canvas renderers re-read on one signal*); a
design-system change is an appearance change like light/dark.

**The registry** is `DESIGN_SYSTEM_IDS` in `lib/theme.ts`, with a label per
id; the preference's schema, the picker and the command read it.

**Guards** (`lib/design-systems.test.ts`, over the stylesheets through
`lib/design-system-sheets.ts`):

- *registry ↔ stylesheets*: one stylesheet per non-default id and none
  without one; each holds exactly its two blocks; `index.css` imports each
  after the default and before the roles.
- *completeness*: a system restates every token the default sets, in every
  variant the default sets it. Two exceptions, and only these: **shared**
  tokens (the JSON Canvas presets, `--canvas-color-*`, are document colours
  — a card saved as red is red in every skin — so no system may set them)
  and **derived** tokens (a default whose value is only `var(--other)`, such
  as `--lab-accent`, follows that token and is inherited unless restated).
  A system may set no token the default does not.
- *contrast*: for every system and variant, each text/ground pair
  (foreground on background, card, popover, secondary, accent, muted and
  sidebar surfaces; muted text; the accent as link text and as a fill;
  destructive and warning text; lab ink on lab ground) meets WCAG AA for
  body text, 4.5:1, computed from the oklch values in the CSS. There is no
  exception list: a pair below AA fails. The same bound holds on the grounds
  the UI composes: every element holding text is read from the JSX (classes
  split by Tailwind's scanner), its ancestors' and its own `bg-*` tints are
  composited in sRGB over each page surface, and its opaque text colour is
  measured on each result — `text-primary` on `bg-primary/10`, a link in a
  selected row's stacked tints. What a class paints is what Tailwind compiles
  it to, and a colour class that paints no design-system token (a palette
  value such as `text-amber-600`) fails. Content one component mounts into another's
  element is declared in the guard's `MOUNTS`; translucent text is not yet
  checked (gap `01M3BEJDX4YP2DPHSCFS66NZK1`).
- *tag chips*: a tag colour is data, so a chip paints inline styles that no
  class walk sees. The guard evaluates what `tagChipColors` returns
  (`color-mix()` in oklab, `var()` resolved per system and variant) for every
  `TAG_PALETTE` entry on every page surface, at 4.5:1. The ink's pull toward
  `--foreground` is each system's `--tag-ink-mix`.
- the lab's bloom bound (`embers/heat.test.ts`) runs over every system's
  accent in both variants.

**Adding a design system:**

1. Add the id and its label to `lib/theme.ts`.
2. Write `design-systems/<id>.css` with the two blocks above. Start from a
   copy of the default's values: the completeness guard names every token
   still missing, and the contrast guard every pair below AA.
3. Import it in `index.css` next to the others.
4. Look at it: every surface in both variants, the graph renderers and the
   lab included (they read the same tokens).

Nothing else changes: layers 2 and 3, the components, the picker and the
command all follow the registry and the tokens.

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
  (Tailwind's fixed 4px) is `rounded-xs`, and `.kb-md-media` applies the
  same step. `rounded-full` is a shape, not a step. Three corners are still
  off the scale (2px resize handles, the 3px inline-code chip, the 5px
  ontology segmented control), under one gap: putting them on a step moves
  each by 1–2px, which is a visible change.
- **Borders.** `--border-width` is what a bare `border` and `divide-*`
  draw: the bridge maps it onto Tailwind's `--default-border-width`, so it
  is read, not merely declared (an earlier unread `--border-width` was
  deleted for exactly that reason). Explicit widths (`border-2`) stay
  Tailwind's.
- **Density** is one multiplier, `--density`. The bridge sets Tailwind's
  spacing unit to `0.25rem × --density`, so every `p-*`, `gap-*`, `w-*`
  and `inset-*` step scales with it, and `tokens.css` derives the outline
  row metrics (`--kb-row-h`, `--kb-indent`, 24px each at density 1) from it.
  Density 1 is Tailwind's own unit, so it reproduces the unscaled layout
  exactly.
- **Faces.** `--app-font` is the UI face, a design-system value like any
  other (Design systems, above).
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
  principles L1) is layer 1 too, read the same way by `lab/kit/palette.ts` through `scene/palette.ts`.
- **Canvas renderers re-read on one signal.** A DOM utility follows a token
  change by itself; a renderer that copied a value out (a colour, the
  graph label face) does not. `useAppearance()` (`stores/prefs.store.ts`)
  resolves everything that changes what the tokens hold, and its `key`
  changes exactly when that does. The graph page hands the key to every
  renderer (`appearanceKey`), and the lab's scene host re-reads the lab
  palette when the appearance changes. Nothing listens to the `.dark` class
  or a preference directly.
- **Canvas-drawn values are outside the Tailwind scale, on purpose.** What a
  renderer paints on canvas or WebGPU is not a class: the graph label sizes
  (11–12px in `sigma-labels.ts`, `cluster-hulls.ts`, `tree-graph.tsx`,
  `force3d-graph.tsx`) and the lab scenes' geometry, light and bloom
  values belong to their renderers. Their colours and faces still come from
  layer 1 (`readTokenColor`, `graphLabelFont()`). Their sizes are scene
  parameters, and no type step names them. The lab's DOM chrome (info card,
  curve panel, scene switcher) is ordinary UI and uses the scale.

### Enforcement

Two questions, two mechanisms, one owner each.

**Policy — "don't bypass the tokens."** `design-tokens/no-raw-design-value`
(oxlint, `harness/lint/design-tokens/`, at `error`) reads every string a UI
module writes. It rejects the forms that do compile but skip the design
system:

- an arbitrary font size, in any data type Tailwind reads as a size (length,
  percentage, absolute-size, relative-size), untyped or typed, in `[…]` or
  `(…)` form, with or without a leading modifier: `text-[11px]`,
  `text-[large]/5`, `text-[length:11px]`, `text-(percentage:--x)`. An
  arbitrary colour (`text-[color:…]`, `text-(--x)`) is not a size and
  passes;
- an arbitrary shadow (`shadow-[…]`), and the shadow families the bridge
  does not own (`drop-shadow-*`, `inset-shadow-*`, `text-shadow-*`);
- an arbitrary radius (`rounded-[5px]`, `rounded-t-[2px]`);
- a Tailwind palette colour (`bg-amber-500`, `text-white`);
- in `components/`, a hex colour literal.

It runs in `bun run lint`. Test and tooling files are exempt — the one
override class in `.oxlintrc.json`: tests, render specs, the harness and the
runner configs, whose hex strings are tag-colour fixtures or rule cases, not
styling. Stories are not in it: a story is UI and is held to the tokens.

**Liveness — "this class emits CSS."** Resetting Tailwind's namespaces
leaves every default step (`text-sm`, `text-sm/6`, `shadow-xl`, bare
`rounded`, `rounded-3xl`) reading like a class while compiling to nothing.
`harness/tests/ui-utilities-live.test.ts` asks Tailwind itself. Its own
`Scanner` extracts the class candidates from each non-test UI module, with
comments blanked, and each candidate is compiled against stock Tailwind and
against `index.css`. A candidate that stock Tailwind turns into CSS and kb's
stylesheet does not is dead, and the test names its file and line.
Comparing against stock Tailwind is what separates a dead class from the
scanner's noise, which emits nothing under either. A fixture test pins the
comparison itself: `text-sm/6` is dead and `rounded-md` is not.
`NOT_CLASSES` exempts the few scanned occurrences that are not classes.
Today there are two, both the word `shadow`: tailwind-merge's theme key in
`lib/cn.ts`, and prose in the lab's Light study description. Each entry
exempts one occurrence, the candidate inside an exact snippet of its file,
so the same word written as a class elsewhere in that file is still checked.
An entry that no longer covers any occurrence fails as stale.

The lint rule does not ask the liveness question, and the harness does not
ask the policy one. Both run in `bun run verify`, so pre-commit and CI apply
them. They are two `#rule` nodes, "Design tokens: no bypass" (lint) and
"Design tokens: every class is live" (harness), each with its `#check`. A
rule's enforcement is derived from one shared check surface, so two
surfaces make two rules.

A sanctioned exception is the soft-rule mechanism for few sites (root
`CLAUDE.md` → Drift markers and gaps): a pinpoint
`oxlint-disable-next-line design-tokens/no-raw-design-value -- GAP [[id]]`
and a `#gap` node. One gap uses it today: three corners sit off the
radius scale (see Radius above), left out of the no-visual-change
restructure because closing it is a visible change. (The graph's
query-error chip, the other one, reads the `warning` token now.) A stylesheet cannot carry a lint disable, so the one CSS site
(`.kb-md-code`) carries a bare `GAP [[id]]` comment, which the harness's
gap-marker check resolves like any other.

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
3. kb MCP registers `ui://kb/view/<name>` resources (MCP Apps extension
   shape); the `render_view` tool is the `render.view` registry action,
   projected like every other action.
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
A graph perspective is a view node whose view is a renderer (DESIGN.md →
Kinds, roles and options → View nodes): its `sys.f.view` names the renderer,
and its lens props are that renderer's params. Its query selects nodes; its
relationship sources select edges; its encodings map fields to label, color,
size/area and group. The graphs the page's picker and the sidebar's Graph
section list are a query over view nodes whose view is in the renderer family
(`familyViewNodesQuery`), not a tag. The UI edits the existing lens fields,
the renderer switch replaces the node's view, and “Save as new perspective”
creates a new view node, filed in the Views list, through the shared action
pipeline. It does not create a separate preset store. New source values
reference field nodes or the seeded source options. The ten sources are one
`sys.graph.sources` list that each source-selecting lens field narrows by
`kind` through a `targetQuery` (DESIGN.md → Kinds, roles and options).
Legacy string settings remain readable and existing values are not rewritten by
seeding. A pinned graph stays pinned: the node keeps its id, so its pin (a
reference to it) still resolves. Search, selection, legend dimming and camera position are transient.
Ontology membership remains a separate scope on the same projection.

Each renderer is a view in `ViewPoint` (UI points: routes and views →
Families of views). Its key, in `@kb/views` (`graph.ts`), owns its settings
(its `params`), its supported encodings and its interaction capabilities; the
graph plugin provides its component. The shared frame disables unsupported
camera operations with a reason, and the settings panel disables every
setting the renderer's params do not declare. A new renderer contributes a
view under such a key and draws the same extracted nodes and edges. The
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
and treemap, and three's WebGPU renderer on the scene kit, laid out by
d3-force-3d, for 3D (3d-force-graph was retired in wave 2026-09-24 g: its
WebGL renderer and composer could not take the kit's stage and post chain).
This change does not add another rendering dependency. [Cytoscape.js](https://js.cytoscape.org/) and
[AntV G6](https://github.com/antvis/G6/tree/v5) are viable graph-engine alternatives,
but adopting either would require a measured capability/performance advantage.
Borrow [G2's](https://github.com/antvis/G2/tree/v5) separation of data, transforms,
and encoding channels, and [Bloom perspectives](https://neo4j.com/docs/bloom-user-guide/current/bloom-perspectives/bloom-perspectives/)
as a product precedent for saved views of one graph.
[Neo4j NVL](https://neo4j.com/docs/nvl/current/) accepts node/relationship data
through adapters; using a Cypher ecosystem renderer would not require changing
kb's datastore or query model.
