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

Server ownership lives behind the stable facade `src/surface/ui.ts`, which
re-exports the public CLI/server seam (`startUi`, `runUiCli`, …). The
implementation modules under `src/surface/ui/` split by concern:

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
- **Mutations**: optimistic local tx → `POST /api/action` (registry.invoke,
  same receipts) → on failure, strict `/api/graph` refetch (never demo
  fixtures mid-session) + toast; if refetch fails, restore plan-touched
  nodes to pre-plan state without rewinding `rev`, drop minted nodes, and
  re-apply only confirmed non-structural actions (text/props) — never keep
  unconfirmed reparent/delete `children[]` fragments. Unrelated live-graph
  nodes (concurrent remote edits) are preserved. Cold-boot `loadGraph` may
  fall back to fixtures; `hydrateFromWire` is boot-only — live resync uses
  `refreshFromWire` so `loadSource` stays `api`. No temp-id dance (nxus's
  pain): client mints final ULIDs, server accepts explicit ids (already
  supported by `node.add`).
- **Change flow**: server fs-watches `.kb/` (catches CLI/MCP/agent writes
  too) → diffs old/new node sets → broadcasts node-level deltas on WS →
  client transacts deltas into DataScript → open queries re-run.

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

- v1 implementation: hub keeps a server-side DataScript conn (reusing the
  query layer); on fs change it re-runs each subscription's query and pushes
  rows if the result hash changed. Coarse but correct; 50k nodes re-query in
  ~20ms, fine for tens of subscriptions.
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

The v1 list above is the original contract. Five implementation waves rebuilt
the interaction layer on top of it — i1 (editor), i2 (graph), i3 (canvas),
i5 (cross-surface polish), i6 (ontology). The normative specs are
`docs/kb-waves/2026-08-23/reports/r1-editor.md`, `r2-graph.md`, `r3-canvas.md`,
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

**Caret geometry is measured, not guessed.** `components/outline/caret.ts`
exposes `readCaretGeometry` (range rects → real line detection),
`verticalArrowDecision` (pure: is this arrow a line move or a row move?) and
`nearestOffsetForX` (column restoration), fed by `outlineStore.focusX`. Offsets
into the *serialized markdown* — not the DOM text — come from
`lib/md-edit.ts` (`getCaretSerializedOffset` / `setCaretSerializedOffset`), a
recursive measure that survives element boundaries and counts an atomic ref
pill at its full token length. A layout-free environment (unit tests, headless)
degrades to offset-based behaviour rather than breaking. `focusSeq` forces
caret re-placement when a row remounts.

**Undo/redo is action-level, not keystroke-level.** `actions/plan.ts`
`invertPlan` computes an inverse transaction against the *pre-application*
state; `inversePlanActions` derives the compensating registry actions.
`outlineStore` keeps bounded `undoStack` / `redoStack` of `{ inv, actions }`
(`HISTORY_LIMIT` = 50). `Cmd/Ctrl+Z` binds outside editable targets, and in api
mode the compensation is posted best-effort — there is **no** server-authoritative
undo journal, and rapid same-node text edits are not coalesced. Structural
operations (split, merge, indent, outdent, delete, move) are the covered case.

**Refs are atomic in the editor.** An active editor renders `[[id|label]]` as a
`contenteditable=false` pill carrying its serialized token, so a raw ULID never
faces the caret and serialization round-trips canonical markdown.

**`sys.*` rows are read-only at the door.** `store.activateNode` degrades a
`sys.*` id to selection so no caret ever enters one; the row shows a hover
padlock instead of failing on write.

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
  the lens); a capped lens shows a dismissible "showing top N of M by degree"
  notice with a jump to the perspective node. Above
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

## Layout

```
tools/kb/
  src/surface/ui.ts              # stable facade (re-exports startUi / runUiCli / …)
  src/surface/ui/
    server.ts                    # Bun.serve boundary + Effect Scope stop + fs-watch
    http.ts                      # Effect REST/API + asset GET + SPA fallback
    session.ts                   # Effect SubscriptionHub (WS protocol)
    assets.ts                    # Effect ui/dist static + .kb/assets
    saved-queries.ts             # Effect .kb/queries listing / virtual nodes
    paths.ts                     # KB_PKG_ROOT, UI_DIST
  src/surface/protocol.ts        # WS/HTTP message types (zod) — shared contract
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

- **U0 (me, small)**: `src/surface/protocol.ts` — zod types for HTTP/WS
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

New module `src/render/`: `render(queryRows, template, format: "html" | "md")`
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

## Port

Fixed default `4321`, `--port` override, auto-open browser on start, bind
127.0.0.1 only. **Portless later** (noted as backlog): unix-domain-socket
transport for local subscriber apps + `kb ui` finding a free port and
registering it in `.kb/runtime.json` for discovery; browser still needs a
TCP port, everything else can go UDS.
