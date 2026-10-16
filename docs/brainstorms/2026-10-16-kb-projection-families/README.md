# kb: the projections become families

Plan of 2026-10-16. The owner's direction: kb is a wrapper around graph
data, with outlining as its editing mode and a number of visualisation
options beside it, everything a plugin in the Cordis sense
(DESIGN.md names Cordis as the model of `@kb/plugin`). The owner delegated
the open decisions below ("to your best jurisdiction, go"); each one taken
under that delegation is marked **decided**.

This builds on the [extension-boundaries plan](../2026-10-04-kb-extension-boundaries/README.md)
and on [DESIGN.md → Extension families](../../../tools/kb/DESIGN.md#extension-families),
and restates neither. It reverses one of its recorded answers, owner
question 2 ("layout and graph: core or extension?"): layout stays core,
outline and graph do not. Where DESIGN.md says what stays core, it changes
in the step that makes the new statement true, not before, so the spec
never describes code that is not there yet. Until then this file is the
home of the decision and its order.

## Why the earlier answer is reversed

The earlier answer kept outline, graph and ontology in core because they
are "the projections the shell opens by default". Which view a node opens
in is data (`resolveNodeView`, `sys.views`), not a reason for code to sit in
core: the shell can be built from the graph and the pane tree alone, and
open whatever view the data names. Keeping two projections in core also
keeps two features the family contract does not test, and it is why
`@kb/ui-sdk` carries editor and graph internals that only one feature uses.

## Target shape

- **Core:** the store, datalog, the kernel, subscriptions, the render
  backbone; and in the browser, the live graph replica, the write path and
  its history, navigation, and the workspace (pane tree, `layout.*`). Core
  names no projection.
- **Families:** `outline` (the editing mode: rows, fields, caret, the
  node ⌘K menu), `graph` (2D and 3D graph renderers), and the existing
  canvas, chart, code, lab, agent, docs, check. Table, Board and Cards
  become their own family, since they are views of a node set, not
  outlining.
- **Ontology** stays core as mechanism (`kb ontology members`, scoping),
  because it is a lens every projection reads; its pages move with the
  family that draws them in a later pass, if one owns them alone.

## Decisions

1. **Outline is a required family** (decided). It is the default editing
   mode, so a store with it switched off would need a second way to open a
   node. Required families already exist (docs, check); another editing
   mode can take the default later by being named in the data.
2. **Graph moves too** (decided), as an optional family, on by default.
   `graph.force3d` is one of its renderers, built on `@kb/scene`.
3. **Ids are frozen** (decided): `outline.main`, `graph.*` and every other
   id keep their spelling, so no store migrates and opening still never
   writes (DESIGN.md → Extension families, "Ids are frozen data").
4. **The default view is data** (decided). `resolveNodeView` stops falling
   back to a literal `outline.main`; the fallback is a view named by the
   seed, so the shell names no view.
5. **`@kb/ui-sdk` keeps only what more than one family uses** (decided).
   An export one family uses moves into that family's `-ui` package when
   the family is cut out.

## Order

Each step is its own commit or wave: restructure first, behaviour
unchanged and proven by the tests that already pass; then move.

| Step | What | Shape |
|---|---|---|
| O0 | This plan; the queue entries in kb | docs |
| O1 | Split `stores/outline.store.ts` by concept: the graph replica, write history and navigation become a core store; editor state (active and selected instance, caret, expansion, transient rows, frame pages) stays the outline's. Every non-outline importer reads the core store | restructure |
| O2 | The default view becomes data; `resolveNodeView` names no view | restructure |
| O3a | Audit `@kb/ui-sdk` exports by the families that use them | read |
| O3 | Cut out `@kb/outline` and `@kb/outline-ui` as a required family; DESIGN.md "What stays core" drops the outline | move |
| O4 | Cut out `@kb/graph` and `@kb/graph-ui` as an optional family; DESIGN.md drops the graph | move |
| O5 | Table, Board and Cards leave the outline as their own family | move |

The ordered queue is data: the todo "Projection families" under the kb work
queue (`01M43DRVEQY02RTSX3XYWB8TG1`), one child per step.

## O1 — what landed where

`stores/outline.store.ts` is split in two, behaviour unchanged.

- **Core: `stores/graph.store.ts` (`useGraphStore`).** The live replica
  (`wireNodes`, `index`, `rev`, `loadSource`, `loadError`; `hydrateFromWire`,
  `applyTx`, `syncFromIndex`, `refreshFromWire`), the write history
  (`undoStack`/`redoStack`, `recordUndo`/`applyUndo`/`applyRedo`), the zoom
  (`rootNodeId`, `homeRootId`, `zoomTo`, `zoomHome`), the
  ontology scope (`ontologyId`, `ontologyMembers`, `ontologyWarnings`,
  `preScopeRootId`, `setOntologyScope`, `reach`), `search`, and
  `scopedWireOf`, the one statement of what a scope shows (`inScope` answers
  for exactly the ids a projection of it holds; `graph.store.test.ts` checks
  that). The schema is built from this store's snapshot alone,
  `schemaOf(useGraphStore.getState())`, once per snapshot. A fixture's
  whole-graph node map is its own schema through a constructor of its own,
  `schemaOfGraph`, so no caller decides what a snapshot's schema is.
  `schemaOfGraph` refuses a scope's projection: `wireToOutlineMap` marks a
  map it built that lacks a node of its graph, by content, so the one cast
  stays checked.
- **Outline: `stores/outline.store.ts` (`useOutlineStore`).** What is the
  editor's own: `expansion` (the rows the reader opened or closed), the
  active and selected row and instance, the caret hand-off,
  `focusSeq`/`focusX`, transient rows, `framePages`, `frameViews`, collapse
  and expand, the visible-instance walk, breadcrumbs, `jumpToNode`, and the
  text-host registry.
- **The rows are derived, not stored.** `outlineNodes()` is what the page
  shows of the graph store's snapshot at default collapse, read through
  `expansion` (`withExpansion`, a view that builds no map). What the page
  shows is the graph store's `shownNodesOf`: the schema, or under a scope the
  scope's own projection, which the graph store builds and caches beside
  `scopedWireOf` (one owner, one cache). Components read the rows with
  `useOutlineNodes()`/`useOutlineNode(id)` over both stores. There is one
  copy of the graph, so no reader can see rows of one snapshot beside
  another. Each snapshot builds the schema map, a scope builds its
  projection, and expanding or collapsing builds nothing
  (`outline.store.builds.test.ts` counts every `wireToOutlineMap` call,
  reads included). A row keeps its object while what it shows is unchanged:
  the schema's object, or one open/closed object per schema node. A schema
  lookup has no side effects; a new schema keeps the unchanged nodes of the
  last two built, so identity never depends on the order of reads.
- **Expansion keeps only undoable choices.** Every write of `expansion`
  drops a choice that equals the row's default, or that names a row which
  can no longer expand (`undoable`), so no row is held collapsed with no
  gesture to open it. Storage keeps exactly those choices, open ones under
  `kb-expanded` and closed ones under `kb-collapsed`, so a reload shows what
  the page showed. Each tab keeps its own expansion while open; storage seeds
  it at load (DESIGN-UI.md → "Expansion is the reader's, per tab").
- **The bridge.** Core names no projection. It defines one port,
  `EditingProjection`, whose contract is stated once on the interface: each
  member is told before the graph store moves and is handed every graph
  state it reasons about, reading none from the store. `follow(change, prev,
  next)` keeps the editor's own state: focus that still has a row (its
  pending caret goes with the active row), transients, and the expansion (a
  row shown open stays open when the move gives it children or fields).
  `leave(from)` prunes an empty transient while `from` still shows it.
  `arrive(at, to)` lands the selection at `to`'s zoom root. The projection
  moves its own state to one valid against both graph states, then the graph
  store moves in one write. `graph.store.test.ts` (with a stand-in
  projection) asserts what each member is handed, and `outline.store.test.ts`
  (with the outline) pins what a reader can see. The outline plugin installs
  the outline's projection (`outlineProjection`) while it is loaded and
  withdraws it on unload, beside the frame-views port, so at O3 the wiring
  moves with the plugin as it is. Withdrawing calls `leave`, as a page move
  does. One installed after a load follows it as a fresh load: a reinstalled
  outline reads its expansion from storage again, and its focus and
  transients start empty. Installing the one already installed does nothing.
  While the plugin is unloaded the rows still follow the graph, and the
  editor's own state stays where it was.
- **Why derivation, not batching.** Round 2 stored the projection and hid
  its lag behind a batching layer that held store notifications for a move
  (`publication.ts`). Each review found another edge in it: unbounded drain,
  per-store arguments, liveness, nested throws. The lag existed only because
  the outline kept a copy. Reading the rows from the graph removes the copy,
  so the layer is deleted, and plain zustand notification is the only rule:
  each store tells its listeners at each write. Undo and redo are single
  writes to the graph store, so the rule covers them as it is.
- **`jumpToNode` checks before it moves.** It works out where the jump
  would land without moving: the graph state that shows the target
  (`reachedState`, the scope left if need be) with its ancestors open. It
  checks that the row shows there under the zoom, or else at home. Only then
  does it reach, expand and go home through `zoomHome`. A refused jump
  changes nothing. When the target is the row being edited, in any outline,
  the page stays put and the row keeps its instance, so going home never
  prunes the row the jump is going to. `setRootNodeId` is gone.
- **Behaviour that changed, deliberately.** Expansion is now the editor's
  own state rather than something read back off the stored rows. It follows
  from that, not from a new rule, that a row the reader closed stays closed
  across graph moves while it can still expand, even when it defaults to
  open, and across a reload; before, the next move reopened it. Expansion
  that another tab wrote to storage is no longer merged in on every
  transaction. It is read at load, as before.

Decisions taken from how code outside the outline uses each member:

- **The zoom root is the page's, not the outline's.** The workspace keeps it
  in saved layouts, the pane title and the switcher name it, commands target
  it, and the graph and ontology pages navigate by `zoomTo`. What the outline
  does when the zoom moves (it lets go of the focus and selects the first row)
  goes through the port.
- **The ontology scope is core** (the plan's "Ontology stays core as
  mechanism"). The graph store resolves membership, and the outline projects
  `scopedWireOf`.
- **Selection stays the outline's**, as the O1 row says. `selectedInstanceKey`
  is an outline row key, selection is clamped against the outline's rows, and
  the graph's select-in-place and canvas cards reach it through the
  `NodeTextPort`, the same port that carries the caret.
- **`jumpToNode` stays the outline's.** "Reveal" expands ancestors and edits
  the row, so it is an editor verb. `getBreadcrumbs` walks the projection and
  only the outline draws breadcrumbs.
- **Undo history is core.** Its entries are action-invocation pairs, and
  nothing in them is outline-specific.
- **Tests follow the split.** `graph.store.test.ts` owns the core: the
  replica, zoom, scope (including restoring `preScopeRootId`), search, the
  write history and the projection port. The graph halves of the old outline
  store tests moved there, and their outline halves stay in
  `outline.store*.test.ts`. A graph-only reset (`resetGraphStore`) goes
  through `replaceGraph`, a load the projection derives from.
- **Pruning a transient is a graph write.** It goes through `applyTx` like
  every other write, rather than a second write path. Focus moves now resolve
  the host they were working in before they prune. The one visible edge is a
  selection left on the pruned row: it now clears at the prune instead of at
  the next transaction. The only caller that leaves such a selection behind
  is `deactivateNode`, which has none in production.

Importers outside `components/outline/` that still read the outline store, so
O3 must route around them:

| Importer | Why it needs editor state |
|---|---|
| `browser-host.ts`, `stores/node-text-port.ts`, `stores/graph-read.ts` | The `BrowserHost`, `NodeTextPort` and `GraphSource` contracts carry the outline's projection, caret, selection and text-host registry. Canvas cards edit through them too. |
| `actions/mutations.ts`, `actions/optimistic.ts` | Editing mutations activate rows, mark transients, read expansion and visible instances (both store imports carry GAP `01M1RXMRB7AZB7DPFR6XBPBKQ9`). |
| `components/App.tsx` | The node-palette shortcut anchors on the active or selected row. |
| `components/palette/command-palette.tsx` | It reveals a hit with `jumpToNode`, and the command context's `OutlineCommandApi` (`outlineCommandApi()`) mixes graph and editor members (O3a). |
| `stores/follow.ts`, `components/ontology/ontology-page.tsx` | A "reveal" follow is `jumpToNode`. |
| `components/graph/graph-adapters.tsx` | Graph bullets draw the outline's bullet appearance, which includes collapse. |
| `components/layout/pane-title.ts`, `components/layout/pane-switcher.tsx`, `ui-plugins.ts` | They look up node text, views and switch versions in the scoped projection. Reading the graph store would change what they show under a scope, which is a behaviour change left to O3. |

## O2: what landed

Two restructures, behaviour-preserving except for the one deliberate change
named under "A broken definition opens", then a fix-up after review. The spec is
[DESIGN.md → View nodes](../../../tools/kb/DESIGN.md#view-nodes) (the
default view type) and → Layout views (the resolver and broken-definition
bullets). This section
records only why the shape is what it is.

- **A view's page is its key's** (`ViewKey.page`). `resolveNodeView` used to
  switch on two families to find a view's page: a frame view shows on the
  outline at the frame, and a renderer shows on the graph page. Each family's
  key builder now states that (`frameViewKey` in `outline.ts`,
  `rendererKey` in `graph.ts`), so the resolver names no family. When O3 and
  O4 cut the families out, the statement moves with their keys.
- **The default view type is data.** `sys.views` carries
  `sys.f.view.default`, a single ref whose targets are the list's own options
  (`VIEW_OPTION_TARGET_QUERY`). Core's seed sets it to
  `sys.view.outline.main`. When a node names no view, the resolver opens it
  as if the route had named that option, on the same code path as any named
  view type. A default whose family is off therefore resolves as unheld
  ("cannot be shown here"). `node-view.ts` no longer imports `OutlineView`.
- **A broken definition opens.** A missing or malformed default, like a
  host whose view node is gone, is reported through `ConfigReport` and
  resolves to a `BrokenViewTarget` carrying the warning. The node route draws
  it as the existing "cannot be shown here" state with the warning as its
  reason; one state, a reason per cause. Only a wrong location (no such
  node, or a route `view` that names no view) still fails as not found. This
  changes one pre-O2 behaviour on purpose: a host whose default view node is
  gone used to open as "Node not found". The resolver tests and
  `unheld-view.acceptance.test.tsx` hold both cases at the route. No gap is
  left.
- **Why a new field on `sys.views`, not an existing carrier.**
  - `sys.f.view` would turn `sys.views` into a view node.
  - `sys.f.views` names view nodes, not options. Naming a seeded template
    view node instead would change the resolved `subject` and `viewNode`,
    which is a behaviour change.
  - Order (the first option is the default, mirroring how a host's default
    is its first view) is refused for two reasons. The order of `sys.views`
    is the fold's, and a store seeded earlier may hold another order (this
    repository's store does, and `viewTypeOrderSurvivesOpening` keeps it).
    It would also tie the default to `BUNDLED_FAMILIES` order at O3.
  - The refusal of an explicit `default` on hosts does not apply here. The
    field selects from the list it lives on and cannot name anything else,
    so it is not a mirror of that list.
- **Seed ownership is core's for now.** `systemSeedNodes` names the frozen
  option id, the same way `view.approval.policies` names
  `sys.view.outline.table`. At O3 the option's provider becomes the outline
  family's declaration, while the ref and the id stay as they are.
- **Existing stores.** A store seeded before O2 gains the field node and the
  prop through `ensureSystemSeed`, by the new-node pass and the fill-absent
  pass, as with every seed addition. That first open after O2 commits the
  change once, and no later open writes. The store contract proves it over
  every backend (`defaultViewTypeReachesEarlierStoreOnce`). The seed golden
  was regenerated in the O2 commit, as its header requires for a deliberate
  seed change.
- **An unset default comes back.** The default is a seeded prop, so the
  existing GAP `01M3A0ZEWWG0VEHXEM3YNKRQ0Y` (fill-absent cannot tell a key
  never held from one unset) now covers it too: an owner who unsets it gets
  it back on the next open. Changing it to another view type sticks.
