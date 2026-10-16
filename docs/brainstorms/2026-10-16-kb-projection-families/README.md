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
  lookup has no side effects; a new schema reuses, per node, the object of
  the first of the last two built that holds an equal node, so identity
  changes exactly when content does, whatever the order of reads.
- **Expansion keeps only undoable choices.** The outline's `expansion`
  drops a choice that equals the row's default, or that names a row which
  can no longer expand (`undoable`), so no row is held collapsed with no
  gesture to open it. A row the graph does not hold now keeps its choice, so
  an undo that restores it restores its expansion. Storage is shared by
  tabs: a save applies only the ids this tab changed onto what storage holds
  then, in one write of the one `kb-expansion` key, and a load writes
  nothing. The legacy `kb-expanded` key is read while `kb-expansion` is
  absent and never written or deleted. Each tab keeps its own expansion
  while open; storage seeds it at load (DESIGN-UI.md → "Expansion is the
  reader's, per tab").
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
  that another tab wrote to storage is no longer merged into an open tab on
  every transaction. It is read at load, and no tab's save erases it.

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

## O3: what landed

O3 landed its restructures and stopped before the move, as Rule 1 allows
("if the clean version is too big for the moment, say so and stop"). The
outline is still a surface of `@kb/ui`, and it is not a half-moved family:
- no `@kb/outline` or `@kb/outline-ui` package exists yet;
- `BUNDLED_FAMILIES` and the resolver are unchanged;
- DESIGN.md "What stays core" still lists the outline, because that is
  still true.

Every commit is a `refactor:`, behaviour-preserving and proven by the tests
that already passed. Review round 1 reshaped the port design, below.

### The two ports

The shell read the outline store for two different things. Each now has a
core port, and the outline implements both directly:

- **`PageProjection`** (`stores/graph.store.ts`): what any projection the
  page stands in offers the shell.
  - Lifecycle: the graph store tells it of moves (`follow`, `leave`,
    `arrive`), as in O1.
  - Observation: `subscribe`, and `rows(graph)`, what the page shows with
    each row open or closed as the projection holds it.
  - `reveal(id)`: the one gesture every surface makes on it.

  `EMPTY_PROJECTION` is what the page stands in while none is installed.
- **`PageEditor`** (`stores/page-editor.ts`): the half of the page that
  holds a caret. It is a store, read as it is (`getState`, `subscribe`).
  Its state carries:
  - the focus;
  - the pending caret;
  - the store half of the kit's `NodeTextPort` (caret hand-off, text-host
    registry, selection), whose shell adapter (`stores/node-text-port.ts`)
    it feeds;
  - `activateNode`;
  - `expandAncestors`, which a structural write asks before it lands the
    caret on the row it moved. `reveal` cannot take its place, because a
    reveal moves the zoom and drops the caret position.

  The kit already held the port shape (`NodeTextPort`). What the shell
  installs is its store, so no new kit interface was minted.
- **One mechanism, `stores/port-slot.ts`,** holds an installed value or the
  port's empty one, behind a stable subscription. Both ports use it.
- **`stores/page.ts`** reads the page as a whole: `pageRows()`,
  `usePageRows()`, and `subscribePage` over the graph, the projection and
  the editor.

How the outline implements them:
- Its store is the page's editor, installed as it is (`useOutlineStore`).
- `outlineProjection` is its move handlers, the store's `subscribe`, its
  rows read through its expansion, and `revealNode`. `revealNode` is the
  jump's body, lifted out of the store so that the store's `jumpToNode` and
  the projection's `reveal` are one function.
- There is no forwarding object.

The outline-only verbs left the core ports:
- **Transient marking** is the outline's editing rule, not a fact about a
  write. The write path mints and focuses (`createEmptyNode`,
  `createEmptyNodeBefore`). The outline's gestures (`createTransientNode`,
  `createNodeBefore`, in `components/outline/editing-writes.ts`) mark what
  they mint.
- **"The row above"** is the row the outline draws above. The write path
  takes the node (`mergeWithPrevious(id, previousId)`), and the outline's
  `mergeWithPrevious(id, instanceKey)` resolves it.
- **Expand all and collapse all** are commands the outline contributes
  through `CommandPoint` (`components/outline/outline-commands.ts`). The
  command context drops `expandAllInScope` and `collapseAllInScope`.

### Where each O1 obstacle's concept now lives

| Former importer | Concept | Home |
|---|---|---|
| `browser-host.ts`, `stores/node-text-port.ts`, `stores/graph-read.ts` | the page's rows; the focus and caret hand-off; activation | `pageRows`/`subscribePage` (`pageGraph` was `outlineGraph`), and `PageEditor` |
| `actions/mutations.ts`, `actions/optimistic.ts` | focus after a write; which rows are open for a split; a reparented row shown | `PageEditor` (`activateNode`, `expandAncestors`) and `pageRows`. Transient marking and "the row above" moved to the outline (above). |
| `components/App.tsx` (palette shortcut) | the focus | `PageEditor`. Selection stays the editor's: it is not workspace-level, because it is an instance key of the outline's rows. |
| `components/App.tsx` (`ViewFilterPopoverHost`, found in O3) | something mounted once for the page | `OverlayPoint` (kit). The outline is in `CORE_UI_PLUGINS`, which every convergence loads, so the host is mounted on every page, as before. |
| `components/palette/command-palette.tsx` | reveal; what a command reads | `PageProjection.reveal`, and `pageCommandApi()`, the one builder both palettes use |
| `stores/follow.ts`, `components/ontology/ontology-page.tsx` | reveal; a member's label | `PageProjection.reveal`; `useShownNodes()` |
| `components/graph/graph-adapters.tsx` | a row's bullet, collapse included | `usePageRows()`, with the kit's `outlineBulletAppearance` as the pure function of the row |
| `components/layout/pane-title.ts`, `pane-switcher.tsx`, `ui-plugins.ts` | what a node says | `shownNodes()`, `useShownNodes()` and `useShownNode()`: the same scoped rows, which none of these read for collapse |

The outline's own modules now sit in `components/outline/`:
- `outline.store` and `outline-hosts`;
- `row-chrome`, `visible-instances`, `selection-keymap`, `frame-rows`,
  `backlinks` and `unicorn-scene`.

So `UI_ALLOWS` fails any store, lib or other surface that imports outline
code. Outside the outline, only the shell's composition root and test
support install or reset it.

### The default view seed

The default view type moves out of core's seed. A declaration's
`defaultView`, one of its own `views` by key, is what the fold writes as
`sys.f.view.default`. The extension contract (`@kb/test-kit`) holds two
promises over every family:
- the fold has one provider, and it provides the view it names;
- the fold refuses a default a family would provide beside another
  provider, or name without providing the view.

Core's declaration still provides it, because it still declares the
outline's views: GAP [[01M52J3DADW4P7YV6907ME9C50]]. The field moves with
those views at the cut, a one-line change. Why it does not stay in core's
seed:
- The bar is that core names no family, and a literal option id in
  `systemSeedNodes` names one.
- Why not in the outline's own seed nodes: `sys.views` is core's node, and
  the fold refuses an id two sources declare.
- So the fold derives the default from a declaration, the way it already
  derives each option from a key. The seed it folds is unchanged: the
  golden and every store stay as they are.

The fold first moved to its own module (`seed-fold.ts`), so that `seed.ts`
stays under the file limit.

### What blocks the move

The outline's production code still imports about 95 sites of shell modules
that `@kb/ui-sdk` does not carry. The narrower ports removed core's reach
into the outline; they did not change how far the outline reaches into
core. Each of these needs a kit-level home first:

1. **The graph store as a kit port.** The outline derives its rows and
   moves from the graph store's state:
   - `shownNodesOf`, `reachedState`, `schemaOf(state)`;
   - `reach`, `zoomHome`, and `applyTx` for a prune;
   - the `GraphStateData`, `GraphChange` and `ScopeSource` types that type
     `PageProjection`.

   That is 19 import sites. `PageProjection`, `PageEditor` and their
   installs must then be reachable from a family, through `BrowserHost` or
   a point. Both are now narrow, so lifting them is mostly lifting the
   graph-state types.
2. **The page's write path as a kit port.** `mutations` has 12 import sites
   and about 30 members; `BrowserHost` carries 5. Beside it:
   - `lib/view-config` (7 sites) and `lib/query-node`;
   - `lib/commands`: the node menu runs the core registry, which still holds
     the outline's node commands (indent and outdent, the frame views'
     "View as").
3. **Shell stores the outline reads directly**: `ui.store`, `prefs.store`,
   `debug-fields.store`, `follow`, `graph-read`, `workspace.store`,
   `ref-ink`, `screen.store`, `frame-views`, `node-text-port`,
   `page-commands` and `page-editor`. Each needs a `BrowserHost` member or a
   kit home.
4. **The field primitives.** Preferences (core) draws `FieldRow`, whose
   glyph comes from the outline's value-views registry. The fix is to split
   the row's anatomy (kit, given its glyph) from the glyph registry
   (outline). That changes `FieldRow`'s props and the tests that render it.
5. **The tests.** 38 of the outline's 46 test files drive the real shell:
   the graph store, the write path, the fixture graph and the test-support
   resets. This count did not shrink with the ports: those tests depend on
   what the outline reads of the shell (items 1–3), not on what the shell
   reads of the outline. In `@kb/outline-ui` they could import none of it,
   because a half's tests hold it to `BrowserHost` through
   `@kb/ui-test-kit`. They must either stay in `@kb/ui` as page tests over
   `@kb/outline-ui`, or wait for a test host that carries ports 1–3.

Proposed order, each step a restructure:
- O3b: lift `PageProjection`, `PageEditor` and the graph-state types into
  the kit, with their installs reachable through a point.
- O3c: the write path as a kit port behind `BrowserHost`.
- O3d: the shell stores the outline reads, as `BrowserHost` members.
- O3e: split `FieldRow`, and contribute the outline's node commands through
  `CommandPoint` in their current order.
- Then the move: `@kb/outline` (declaration, keys, seed and `defaultView`)
  and `@kb/outline-ui` (the zone and the O3a exports).

### Behaviour that changed

Behaviour changed only in a state the page never reaches. While the outline
plugin is unloaded, the shell reads the empty projection and editor (rows at
default collapse, no focus, a `reveal` that does nothing) instead of the
outline store. The outline is always loaded on the page (`CORE_UI_PLUGINS`).

### Gaps

- Opened, by the coordinator: `01M52J3DADW4P7YV6907ME9C50` (core's
  declaration still declares the outline's views and provides the default
  view). It is marked at `core-extension.ts` and listed in DESIGN.md's drift.
- Narrowed: `01M1RXMRB7AZB7DPFR6XBPBKQ9` (actions read the page stores).
  `actions/` no longer imports the outline store. It reads the graph store
  and the page's ports (`page`, `page-editor`), and the markers stay on
  those imports. The node's `current` text needs updating.
- Untouched: `01M436DVSEHKNYWSF2MR07HPMR`. Its marker is accurate.

## O3b–O3e: what landed

Each step is a `refactor:` commit, behaviour-preserving and gated. After
them, no production file of `components/outline/` imports `@/stores`,
`@/actions` or `@/lib`: the outline reaches the shell through
`@kb/ui-sdk` alone, which is what the move needs.

### O3b: the page's graph and ports are the kit's

- `lib/page-graph`: `PageGraphState` (what a projection reads of the graph
  store; the store's state extends it), `GraphChange`, `ScopeSource`, and
  what the page shows (`scopedWireNodes`, `scopedWireOf`, `shownNodesOf`,
  `inScope`, with the one cache of a scope's view). Later commits add
  `PageGraphPort` and `listOntologyItems` here.
- `lib/page-ports`: `PageProjection`, `PageEditor` and their empty values.
  A plugin provides each as a kernel **service** (`PageProjectionService`,
  `PageEditorService`), not a point: a service has one provider, so a second
  projection is refused as a service conflict, which is the rule a page
  standing in one projection needs. The shell's slots follow what the kernel
  provides (`followProvided`), and a stand-in a test installs directly stays.
- The frame-views port is deleted: reading `ViewPoint` (`providedFrameViews`)
  answers exactly what it answered.
- Review follow-up: `PageEditorState` names the editor's half of
  `NodeTextPort` as a `Pick`, and `editorTextPort` forwards it once; the
  shell's text port spreads it.

### O3c: the write path, and the frame's view

- `PageWrites` (`lib/page-writes`) is the write path's port, with the
  contract docs that sat on `mutations`; `mutations` is typed by it.
  `BrowserHost.writes` carries it, in place of five write members it
  restated. The graph's three writes (`setGraphRenderer`, `setLensProp`,
  `saveGraphPerspective`) are members already, so O4c needs no new write.
- `lib/view-config` held two concepts: reading a frame's view (`frameViewOf`,
  `frameConfigOf`, …, which the writes read too) moves to the kit
  (`lib/frame-view`, `lib/view-node`); laying a frame out (filters, table,
  board) moves into the zone (`frame-layout`).
- `resultNodeIds` joins the kit's query-rows hook. The socket binding stays
  the shell's, reached as `subscribeQuery`.

### O3d: the shell stores, as host members and homes

- Outline-only libraries move into the zone: value kinds, the value slot's
  keymap and navigation, date/number/url display, the date editor and its
  calendar, picker recency.
- Shared ones move to the kit: `lib/pinned` (with the Pinned rows and
  `SidebarNavItem`), `lib/schema-zoom`, `listOntologyItems`.
- `BrowserHost` gains `graph` (`PageGraphPort`: state, subscribe, `reach`,
  `reached`, `drop`), `zoomHome`, `prefs()` (`Prefs` moves to the kit;
  `theme()` was one field of it and is gone), `debugFields`,
  `filterFrame`/`setFilterFrame`, `nodePaletteOpen`, and
  `nodeCommands(target, palette)`. The kit's hooks read them
  (`usePageGraph`, `usePrefs`, `useDebugFields`, `useGraphRead`,
  `useOpenNode`, …); the test host stands in for each.
- `PageProjection.leave` answers the empty row it minted instead of pruning
  it: the graph store prunes it as its own transaction before it moves
  (`leavePage`). A projection makes no write while the page moves, and an
  outline torn down after the host (the kernel removes a service before its
  dependents) does not reach for a host that is gone.

### O3e: `FieldRow`, and the node menu

- `FieldRow` is kit anatomy, handed its glyph; the outline passes its kind's
  glyph from the value views' registry (`fieldGlyphOf`). `PrefFieldRow`
  moves with it. The outline's field components are no longer a primitives
  zone of their own.
- **The node menu stays a query over the shell's one registry**, through the
  host (`nodeCommands`), built by one builder for both palettes
  (`pageCommandContext`). The outline's own node commands (indent, outdent,
  "Filter…") did not move to `CommandPoint`: the menu's order is list
  position, and a contribution lands after the default-view rows, so moving
  them would reorder the menu. Moving them needs `CommandPoint` to carry a
  menu order: GAP [[01M531QSQ2DJDSPYB132RQ5RBC]]. The same limit is why
  expand-all and collapse-all, contributed since O3, sit after the default-view
  commands rather than between the debug and filter commands, as Sol's
  review noted; the order change stands until that order exists.

### Tests

The decision (coordinator): the outline's shell-driving tests stay in
`@kb/ui` as page tests over the outline. What changed for them:
- `@kb/ui`'s test setup loads the shell's host before a file's hooks, unless
  the file's page provided it (the App does). A test that loads plugins
  loads them behind the host (`syncPagePlugins`, 25 files). Each still loads
  the plugins it loaded; what they assert is unchanged.
- Tests that rendered `FieldRow` by its `fieldType` hand it that type's
  glyph. Source assertions read the new homes.
- The graph store's projection stand-in answers that it minted nothing, and
  reads the revision it was handed through the state's own `rev`.
- `UI_ALLOWS`' `test-support` row reaches `shell` (the host
  `syncPagePlugins` loads).

### Gaps

- No gap id was opened in code. Placeholders, minted since by the coordinator:
  - **GAP [[01M531QSQ2DJDSPYB132RQ5RBC]]: the node menu's order is list
    position.**
    expected: a node command declares where it sits in the menu, and the
    menu lists the registry's commands and every `CommandPoint` contribution
    by it; current: the registry's static list, then the views' rows, then
    contributions in load order, then "Filter…"; impact: a family cannot
    contribute a node command to a slot (the outline's indent, outdent and
    "Filter…" stay the shell's, and expand/collapse all moved after the
    default-view rows); closes: an order on node commands.
  - **`test-support` reaches the outline's zone** (a placeholder, closed
    by the move before it was minted).
    The row the O3 zone move added (`test-support` → `components/outline`,
    for `resetOutlineStore`, `active-text-host` and the isolation probe)
    carries no gap. It closes with the move, when those helpers import the
    outline's package (or the outline's own test entry) instead of a zone.
- `01M1RXMQPVJKREGDS7D37J1MWN` is closed already; the node menu's comment
  that cited it is gone with the context it built.

## The outline move: what landed

The outline is a required family of two packages. One `refactor:` commit,
behaviour-preserving except for the seed's view order (below).

### What moved where

- **`@kb/outline`** (`packages/extension/outline`, `scope:shared`,
  `family:outline`) holds the family's declaration, `outlineExtension`, and
  its shared plugin, `outlinePlugin()`.
  - The declaration has no `optional`, so it is required, and
    `extension.switch` refuses it.
  - It provides the default view type (`defaultView: OutlineView`).
  - It lists the outline's six views.
  - Core's declaration lists none of them now, and no longer provides the
    default.
- **The keys stay in `@kb/views`** (`outline.ts`). This deviates from
  "keys in `@kb/outline`": core's ontology page names the outline's view in
  a `ViewSlot` (an ontology's outline view is the outline view). A key that
  moves to the family is one core can no longer name. There is no seed to
  move either: the outline's views are its only seed, and the fold derives
  their options.
  - After review, the ontology page names no view: its scope opens in the
    store's default view type (`resolveDefaultViewType`, the reader a node
    naming no view opens through). The keys still stay, for another
    reason: a frame view's page is the outline at its frame
    (`frameViewKey`'s `page` names `OutlineView`), and O5 gives the table,
    board and cards to a family of their own, which may not reach the
    outline's package. The frame-view key mechanism and the outline's page
    key are core's for as long as frame views of two families page into it.
- **`@kb/outline-ui`** (`packages/extension/outline-ui`, `scope:browser`,
  `family:outline`) holds:
  - every production file of the old `components/outline/` zone;
  - the zone's 16 tests that need no shell;
  - the two field-value stories, with their own smoke test.

  Its entry, `outlineUiPlugin`, is named for the declaration and loads
  `outlinePlugin()` as a child. It injects `BrowserHostService`, as the
  other halves do: the projection and editor it provides read the graph
  through the host (corrected after review; the cut first said it injected
  nothing).

  The barrel exports the entry and the parts the page tests drive.
- **Registration.**
  - `BUNDLED_FAMILIES` lists the outline first.
  - The server's entries list `outlinePlugin()` first.
  - The page's resolver gives the outline a static `load`, and
    `CORE_UI_PLUGINS` no longer lists it.
  - The outline's views and seed are unchanged, so its option ids and
    `sys.f.view.default` are unchanged too.
- **The 37 page tests** live in `@kb/ui` under `src/page-tests/outline/`,
  importing `@kb/outline-ui`. This is the coordinator's decision. They are
  their own zone, `page-tests`, with no row but itself: every one is a test
  file, and test files are exempt.
  - One `vi.mock` (`update-cost`'s row chrome) names a module inside the
    package by path, as the kit mock beside it already did.
  - Source assertions read `browserSource("@kb/outline-ui")`.
- **`@kb/ui`'s `src/test-support/` is test code to the harness.**
  - `isPackageTestFile` counts a package's `src/test-support/` helpers as
    tests.
  - `TEST_SUPPORT_PACKAGES` names the packages allowed one: those whose
    importers a check holds to tests. For `@kb/ui`, that check is the zone
    matrix, where no row names `test-support`.
  - A package that grows the folder without such a check fails.
  - So `resetOutlineStore`, the active text host and the isolation probe
    import `@kb/outline-ui` through the composition-root fence's test
    exemption.
  - The `test-support` row no longer reaches an outline zone.

### The seed's view order changed

`sys.views` lists core's options first, then each family's, in bundled
order. The outline's six options used to be core's first ones. Now they come
after core's (after `layout.node`) and before the canvas's. The seed golden
(`app/test-kit/src/seed.golden.jsonl`) was regenerated. Its only change is
that children order, and the default view's id is the same.

A store opened before this keeps its order (`viewTypeOrderSurvivesOpening`).
Only a fresh store lists the outline's view types after core's, in the
view-type pickers.

### Tests that changed meaning

- The runtime's gates test: the required families are `outline`, `docs`
  and `check`, and it writes all three off by hand.
- The extension contract's canvas case: the option before the canvas's is
  the outline snippet.
- `kb ext list` lists `outline`.
- `ui-plugins.test.ts`: the page loads the outline as a family, first.
- The catalog smoke no longer holds the field-value stories; the outline's
  own smoke does.
- The harness: a `src/test-support/` helper is a test file, and only
  `TEST_SUPPORT_PACKAGES` may have the folder.

### Gaps

- **Closed: GAP [[01M52J3DADW4P7YV6907ME9C50]].** Core no longer declares
  the outline's views or provides the default view type. The marker is gone
  from `core-extension.ts`, and from DESIGN.md's drift list; the coordinator
  closed the `#gap` node.
- **Closed: the placeholder "`test-support` reaches the outline's zone".**
  There is no outline zone any more. The helpers import the package, as test
  code.
- **Kept:** GAP [[01M52YKFN18S0PJR2PHHM5QTXZ]], core's import of the graph's
  keys, on its own line in `core-extension.ts`.
- **New: GAP [[01M531QT1YPM9NTF6NKH9BP66S]]: the outline's page tests run in the shell**
  (minted by the coordinator; marked in `@kb/outline-ui`'s barrel).
  - expected: a family half's tests hold it to `BrowserHost` through the
    test host (DESIGN-UI → Extension UI halves).
  - current: 37 outline tests drive the shell's graph store, commands and
    palettes from `@kb/ui`'s `src/page-tests/outline/`, over a barrel that
    exports what they drive.
  - impact: the barrel is wider than the entry, and these tests cannot run
    in the package.
  - closes: each test rewritten over the test host and moved into
    `@kb/outline-ui`, with the barrel narrowed to its entry.
- **Unchanged:** the node menu's order, GAP [[01M531QSQ2DJDSPYB132RQ5RBC]] (O3e).

## O4a: what landed

O4a is the graph's restructure, with no move. The graph visualisation (the
graph page, its renderers, neighbourhoods and perspectives) is still core,
as DESIGN.md says. Every commit is a `refactor:`, behaviour-preserving and
proven by the tests that already passed. Naming: the *graph store*
(`stores/graph.store.ts`, the page's live replica) is core and stays core.
*The graph* below is the visualisation.

### What moved where

- **The graph zone.** The helpers in `app/ui/src/lib` that only
  `components/graph/` imports moved into that zone, with their tests:
  - `bullet-gpu`, `convex-hull` and the `graph-*` modules (`arrival`,
    `bindings`, `dim`, `drag`, `fade`, `interaction`, `label-layout`,
    `label-paint`, `layouts`, `link-styles`, `neighbourhood`);
  - `graph-sources.test.ts`;
  - the sidebar's Graph section selector, `listPerspectiveNavItems`, from
    `lib/sidebar-nav` to `components/graph/perspective-nav.ts`.

  `UI_ALLOWS` already fenced `components/graph` (only the shell and the
  catalog may import it), so moving the files is what brings them under the
  fence. `constraints.ts` is unchanged. Nothing graph-specific is left in
  `lib/`.
- **The kit's graph-only browser exports** moved to the zone:
  - `bulletExtent` to `bullet-gpu`;
  - `GRAPH_LABEL_WIDTH` and `fitGraphLabel` to `graph-label-layout`.
    `wrapGraphLabel`, which the canvas uses too, now takes its width;
  - `graphPath` beside `matchGraph` in the graph's `routes`.

  The audit was wrong about two of its graph-only exports, and both stay in
  the kit:
  - `keptLoad` produces the `RetryableError` that the kit's
    `ViewErrorBoundary` retries, so it is half of a kit mechanism;
  - `lensReport` binds the lens decoder to the kit's log, which the lab
    needs too.
- **`@kb/graph` (`packages/domain/graph`, `scope:shared`).** It holds the
  graph's isomorphic code:
  - the edge projection: `collectEdges`, `LensEdge` and `LensSource`;
  - the tree: `buildTreeForest` and `LensTreeNode`;
  - perspectives: `decodePerspective(node, report)` and
    `resolvePerspective`;
  - the view keys, moved from `@kb/views`' `graph.ts` as `views.ts`:
    `GraphView`, the five renderer keys, `NeighbourhoodView`, their params,
    `GRAPH_NAMESPACE`, `RendererKey` and `isRendererKey`.

  The kit's `extractLensGraph` reads its edges from the package. The kit's
  `parsePerspective` is `decodePerspective` bound to the kit's log, in the
  way `lensConfig` binds `decodeLensConfig`. Core's declaration still lists
  the graph's views, which it now imports from `@kb/graph`. The ids are
  unchanged.

### Why `@kb/graph` sits in the domain layer, for now

The brief asked for `packages/extension/graph`. An extension package cannot
exist before its family is declared:
- the harness (`families.ts`) requires that its `family:` tag equals the
  name of a `defineExtension` declaration, and that a root of each host
  loads it;
- once a `graph` family exists, the `components/graph` surface of `@kb/ui`
  fails unless `CORE_BROWSER_HALVES` lists it under a gap.

Declaring the family is the cut. So the package sits where the graph's
shared code already sat (the domain's `@kb/views`), which is accurate while
DESIGN.md lists the graph as core. Its name is the family's, so the cut
moves the folder and adds the tag and the declaration, and no import
changes.

The view keys did move without the declaration, because core's declaration
can list them from any shared package. Two things stay behind until O4d
and the cut:
- the ids: the `sys.f.lens.*` fields, `sys.graph.sources` and its options
  (`@kb/model`'s `graph-schema.ts`), and `lens.all-mentions`;
- the lens codec (`@kb/views`' `lens.ts`, including `EdgeKind`).

Obstacles 3 and 4 below say why.

### Duplicates

There was no server duplicate to collapse:
- No server or MCP code computes the graph's edges, trees or
  perspectives.
- `render.view` draws a graph view node as generic markdown
  (`view-markdown.ts`): its settings, and the nodes its `lens.query` selects.
  That reading of `lens.query` is the generic subject of any view node with
  a query, and the outline's query views have one too. Its rules differ from
  the graph's node set: no schema elision, and the first column rather than
  the first known id. It is a different question, and making the two agree
  would change what `render.view` prints, so it was left alone. It is already
  covered by GAP `01M40X30G92A0E57C02JHQ9A1G` (a view's layout is not drawn
  in text).

Two small mirrors inside the graph were collapsed:
- the 2D label clamp restated 220 instead of naming `GRAPH_LABEL_WIDTH`;
- a graph path was built in the kit's router and read in the graph's
  `routes`; both now live in `routes`.

### What blocks the cut

The graph reaches into the shell far less than the outline did. Its
production code makes 16 shell imports in 8 files. The harder obstacles are
what core and the other families name of the graph.

1. **The family declaration and the hosts.** Two steps have to land
   together, or each leaves a fence breach under a gap:
   - `@kb/graph` moves to `packages/extension/graph`, takes
     `family:graph` and `defineExtension({ name: "graph", optional:
     { byDefault: "on" }, views, seed })`, and joins `BUNDLED_FAMILIES`;
   - it gets a server entry (`app/runtime/src/bundled.ts`), and
     `components/graph` becomes `@kb/graph-ui`, loaded by the browser
     resolver instead of `CORE_UI_PLUGINS` (`ui-plugins.ts`).

   Landing one without the other needs `CORE_BROWSER_HALVES: graph` or
   `EXTENSION_ROOT_BREACHES` entries, each under a gap
   (placeholder: *graph browser half*, an id to mint).
2. **Importers of `@kb/graph` that would cross a fence once it is an
   extension package:**
   - `@kb/ui-sdk` (`graph-lens.ts`): a kit may not import an extension
     package. `extractLensGraph` and the rest of the kit's lens
     (`listPerspectiveNodes`, `parsePerspective`, `lensConfig`,
     `lensReport`, `LensGraph`, `LensNode`, the colour, size and cluster
     resolvers, and `queryNeighbourhood`) have to leave the kit. What they
     build on (tag colours, `graphDisplayText`, the log) is used by other
     families and stays in the kit, so they can go to `@kb/graph-ui`.
   - `@kb/lab-ui`. The lab's graph study draws the graph's default
     perspective through `extractLensGraph`, `listPerspectiveNodes`,
     `parsePerspective` and `resolvePerspective`. The family fence forbids
     lab → graph. Either the graph provides "the lens graph of a
     perspective" as a service the lab injects (a hard dependency, so the
     study is pending while the graph is off, as DESIGN-UI.md → "Views are
     soft and services are hard" puts it), or the study reads its own lens.
     This is a decision for the owner (placeholder gap: *lab reads the graph's lens*,
     if it is deferred).
   - The ontology, which is core. `components/ontology/surfaces.tsx`
     embeds `GraphView` for the `/o/<id>/graph` tab, `@kb/views`'
     `ONTOLOGY_VIEWS` names `"graph"`, and the kit's `ontologyPath` builds
     the path. Core may not import the family. Either the ontology names
     the view by its id through the catalog (soft: "cannot be shown here"
     while the graph is off), or the graph contributes the ontology's
     graph tab.
   - `@kb/views`' own tests use `NeighbourhoodView` as their example of a
     view that is not the default. A domain package may not depend on an
     extension package, even as a devDependency, so they switch to a core
     view such as `OntologyScopeView`.
3. **The lens codec is shared.** `lens.ts` is one slot table, and two kinds
   of slot share it:
   - core's slots: `lens.focus`, which the outline's and the layout's views
     write through `encodeLensConfig`, and `lens.query`, which
     `view-markdown.ts` reads for every view;
   - the graph's slots: the renderer, the settings (`LENS_SETTINGS`), the
     mappings, `EdgeKind`, and `DEFAULT_RENDERER`, which names
     `graph.force2d`.

   The codec has to be split so that core keeps its slots and the graph's
   move to `@kb/graph`. The renderer keys and `NeighbourhoodParams` build on
   the graph's half.
4. **The seed.** `systemSeedNodes` (`@kb/model`) seeds the graph's nodes:
   the `sys.f.lens.*` fields, `sys.graph.sources` and its options (built
   from `graph-schema.ts`, which only the graph and the lens codec read),
   and the `lens.all-mentions` perspective. `view-migration.ts` retires the
   legacy `#graph-perspective` tag. The ids are frozen and move into the
   graph's declaration `seed`. The codec has to split first (3), because
   `@kb/model` cannot import `@kb/graph`.
5. **The graph's writes are core's.** `actions/mutations.ts` holds
   `saveGraphPerspective`, `setGraphRenderer` and `setLensProp`, and
   `actions/plan.ts` holds `planSetGraphRenderer` and `planSetLensProp`.
   They need the write path as a kit port (O3c), or they become actions of
   the graph's shared plugin.
6. **What the zone reads of the shell** (production, 16 import sites in 8
   files):
   - `stores/graph.store`: `wireNodes`, `index`, `zoomTo` and
     `ontologyMembers`. `BrowserHost` already carries the first three
     (`useWireNodes`, `useIndex`, `zoomTo`), but not `ontologyMembers`.
   - `stores/prefs.store` and `stores/ui.store`: the theme, the
     appearance, the sidebar toggle and whether Preferences is open. The
     kit's `useTheme`, `useAppearance`, `useSidebarToggle` and
     `usePrefsOpen` already carry all of them.
   - `stores/page` (`usePageRows`) in `graph-adapters.tsx`, where a graph
     bullet draws the outline's bullet appearance, collapse included. This
     waits for the page projection as a kit port (O3b).
   - `actions/mutations`: the four writes (5).
   - `lib/ontology-scope` (`listOntologyItems`) and the primitives
     `components/ui/ontology-picker` and `workspace-boundary`.
   - `lib/sidebar-nav` (the `SidebarNavItem` type).
7. **Tests.** The zone has 37 test files. Only `graph-page.component` and
   `neighbourhood-view.component` drive the shell (the graph store,
   `fixtureGraph` and `resetOutlineStore`). `graph-discs` reads the
   fixture graph, and `force3d-light` reads the design-system sheets. At
   the shell's root, `scene-contract.test.ts` and `lab-heat.test.ts`
   import the zone, and the catalog's two graph stories render it. These
   are far fewer than the outline's 38.
8. **The lazy fence.** three must stay `UI_LAZY_DEPTH` (2) dynamic imports
   below the entry. Today the graph plugin is in `CORE_UI_PLUGINS` and
   loads with the page. Its renderer chunk and the 3D chunk inside it are
   the two lazy boundaries. Once the browser resolver loads `@kb/graph-ui`,
   the depth has to be checked again (`ui-lazy-fence.test.ts`).

Core names nothing else of the graph. The palette, commands, App, workspace
and screen have no graph code, and `@kb/scene` is imported only by the zone
and by the lab.

### Proposed order

Each step is a restructure, in the order of the dependencies above.

- **O4b**: the zone reads the page through `BrowserHost`, using the
  members that exist (wire nodes, index, zoom, theme, appearance, sidebar,
  Preferences). It needs no new port and does not touch builder A's files.
- **O4c**, after A's O3b–O3d: the remaining reads. The bullet comes through
  the lifted page projection. `ontologyMembers` and the ontology list come
  through a `BrowserHost` member. The graph's three writes go through the
  write-path port or the graph's own actions.
- **O4d**: split the lens codec (3). Core keeps `focus` and `query`; the
  graph's slots, `EdgeKind`, `LENS_SETTINGS`, `DEFAULT_RENDERER` and
  `graph-schema.ts` move to `@kb/graph`. `@kb/views`' tests switch their
  example view.
- **O4e** (decided; landed in O4c–O4f): the owner decides on the lab and
  the ontology (2). Then the kit's lens (`graph-lens.ts`,
  `queryNeighbourhood`) moves out of the kit, its pure parts into
  `@kb/graph`.
- **O4f**, the cut:
  - `@kb/graph` moves to `packages/extension/graph` with its tag and its
    declaration (the seven views, the seed of 4, optional and on by
    default), joins `BUNDLED_FAMILIES` and gets its server entry;
  - `components/graph` becomes `@kb/graph-ui`, and `CORE_UI_PLUGINS`
    drops `graphUiPlugin`;
  - the switchable-family case in `ui-plugins.test.ts` covers the graph;
  - DESIGN.md "What stays core" drops the graph.

### Tests that changed meaning

None of the existing tests changed meaning. These moved or are new:
- **Into `@kb/graph`, rebuilt:**
  - The perspective round trip now runs through `decodePerspective` with a
    report that throws, so it also asserts that nothing is reported.
  - The case "projects cycles and shared descendants once" is now built
    over literal tree nodes rather than over nodes extracted by
    `extractLensGraph`. It has the same ids, edges and assertions.
- **Into `@kb/graph`, as they were:** `resolvePerspective`'s cases.
- **New in `@kb/graph`:** cases for each edge kind, parallel-edge weight,
  set restriction, tree focus and fallback, the label rule, and a
  malformed prop being reported. Before this, the edge projection was
  private and tested only through `extractLensGraph`.
- **Moved unchanged:** the `fitGraphLabel` cases, into
  `graph-label-layout.test.ts`, and the Graph section's case, into
  `perspective-nav.test.ts`.

### Gaps

O4a opened and narrowed no gap, and no `GAP` marker in code changed. The
two placeholders above (*graph browser half*, *lab reads the graph's lens*)
are for the steps that would defer a fence, and only if they do.

## O4b and O4d (first half): what landed

Three `refactor:` commits, behaviour-preserving, none in builder A's files.

### O4b: the graph reads the page through `BrowserHost`

- **The graph plugin injects the host** (`inject: [BrowserHostService]`),
  as the canvas, chart, code, lab and agent halves do, so it waits as
  pending until the shell provides it. `CORE_UI_PLUGINS` loads the host
  first, so the page is unchanged. The three tests that load the graph
  plugin on its own now load the host plugin beside it.
- **Reads that already had a host member moved to the kit's hooks:**
  - the wire nodes, the index and its generation (`useWireNodes`,
    `useIndex`, `useGeneration`);
  - the theme, the appearance, the sidebar toggle and Preferences
    (`useTheme`, `useAppearance`, `useSidebarToggle`, `usePrefsOpen`);
  - `zoomTo`;
  - the relationships checkboxes' `replaceField`;
  - the rows a bullet is drawn from. The host's `useNodes` answers from
    `pageRows`, as `usePageRows` did, so obstacle 6's bullet did not need
    O3b after all.

  The shell's `usePageRows` and the prefs store's `useAppearance` lost
  their last readers and are deleted. The zone's production shell imports
  went from 16 to 9.

### O4c: what is left, after builder A lands

| Read or write | Where | What it needs |
|---|---|---|
| The ontology scope's members (`ontologyMembers`) | `graph-page.tsx` | A host read |
| The ontology list (`listOntologyItems`) | `graph-page.tsx` | A host read, or the pure helper moved to the kit. The ontology pages, the sidebar and the commands read it too |
| `setGraphRenderer`, `setLensProp` | `graph-page`, `graph-mappings`, `graph-settings` | **No new member.** Each is the host's `replaceField` of one field (`planSetGraphRenderer` and `planSetLensProp` are `planReplaceField`). They become the graph's own writes in the zone, over `replaceField`. The `mutations` members, the two `plan.ts` helpers and `actions/lens-renderer.test.ts` move or go in the same commit, which is why it waits for A |
| `saveGraphPerspective` | `perspective-picker.tsx` | A host write that adds a view node filed in the Views list with given props. `proposeView` cannot stand in: it refuses lens props beyond a renderer's params (GAP `01M40X30Q8N7NYCYHW3J0GFKY7`). The alternative is a graph action |
| The `ontology-picker` and `workspace-boundary` primitives | `graph-page`, `graph-adapters` | Kit components |
| `SidebarNavItem` (a type) | `perspective-nav.ts` | The kit's sidebar row shape, or a local type |

I tried the `setLensProp` and `setGraphRenderer` move in O4b and reverted
it. Leaving the `mutations` members behind would have made a second path
for the same write, and deleting them means editing A's file.

### O4d, first half: a view's subject is core's

`lens.focus` and `lens.query` are every view's subject, not the graph's:
- the outline, its snippet, the layout's node view, the chart and the code
  view are rooted by `lens.focus`;
- the docs views and `render.view` read `lens.query`.

`@kb/views` now states the subject once, in `subject.ts`:
- `SUBJECT_SLOTS`, the two slots;
- `subjectRootOf(props, host)`, the root a view draws: its stored focus,
  else the node it is shown for. Five views restated this before;
- `subjectRootProps(root)`, how the root is stored.

The five views read and write through it, and the graph's lens decodes its
query and focus through the same slots. So no core view, and no other
family, uses the graph's lens codec any more.

### O4d, what stops before the move

- **The graph's half of `lens.ts` moving to `@kb/graph`.** This covers
  `LensPerspective`, `LensProps`, the settings and mappings, `EdgeKind`,
  `DEFAULT_RENDERER` and `perspectiveProps`. Its only importer outside the
  graph is `actions/mutations.ts`, where `saveGraphPerspective` imports
  `LensPerspective` and `perspectiveProps` from `@kb/views`. `@kb/views`
  cannot re-export them from `@kb/graph`, which depends on it. So the move
  lands with, or after, `saveGraphPerspective` leaving `mutations` (O4c).
- **`graph-schema.ts`.** `@kb/model`'s `systemSeedNodes` builds the graph
  sources and the lens fields from it, and `@kb/model` cannot import
  `@kb/graph`. It moves with the graph's seed. Splitting the seed earlier
  (the graph's nodes as a second seed source that core's declaration folds)
  would change the fold's order and so the seed golden. That is a
  deliberate seed change, so it belongs to the cut (O4f), with the
  declaration's `seed`.

### O4e: recommendation, for the owner (decided: taken, see O4c–O4f)

- **The lab reaches the graph through a kit service, not the graph's
  package.**
  - The kit (`@kb/ui-sdk`) names a service key, "the lens graph of a
    perspective" (the default one, or one by id), in the `LensGraph` shape
    the kit already holds. The graph's browser half provides it.
  - The lab injects it, so the lab's graph study is pending while the graph
    is off. That is DESIGN-UI.md's "services are hard": a study that draws
    the graph cannot draw without it.
  - This keeps one owner of the extraction, and the lab imports nothing of
    the graph's family, so the family fence holds.
  - The alternative, the lab reading its own lens, would be a second
    extraction.
- **The ontology names the graph's view by its id, softly.**
  - The ontology's graph tab draws the view the catalog holds for
    `graph.page`, by id through `ViewSlot` and the catalog. With the graph
    off it shows the existing "cannot be shown here" state, by the option's
    label (`viewNamed`).
  - The `/o/<id>/graph` route segment and `ONTOLOGY_VIEWS` stay as data.
  - This is "views are soft", and it needs no new point. The alternative,
    the graph contributing the ontology's tab, would make the ontology's
    routes depend on a family.

### Tests that changed meaning

None did:
- the graph plugin's three tests load the host plugin, as the page does;
- `@kb/views` gains `tests/subject.test.ts`, the root reading and the
  lens's subject round trip.

### Gaps

None opened, narrowed or changed.

## O4 review follow-up

Sol's review of O4a, O4b and the first half of O4d asked for five fixes:

- **The package cycle is gone, and a cycle now fails.** `@kb/views`' tests
  used the neighbourhood and the graph page as examples, through a
  devDependency on `@kb/graph`, which depends on `@kb/views`.
  - Those tests now use core's views: the outline snippet and the layout
    view.
  - The graph cases moved to `@kb/graph`'s `tests/views.test.ts`.
  - That settles obstacle 2's last bullet early.
  - `constraints.ts` states the rule (`dependencyCycles`), and
    `boundaries.test.ts` applies it: no package reaches itself through its
    declared dependencies. Test-world devDependencies are exempt.
- **The neighbourhood reads its root through `subjectRootOf`.** It was the
  sixth copy of that rule.
- **Core's import of the graph's view keys is a recorded gap:**
  GAP [[01M52YKFN18S0PJR2PHHM5QTXZ]], marked on the import in
  `core-extension.ts`. It closes when the graph's declaration lists its own
  views (O4f), beside GAP [[01M52J3DADW4P7YV6907ME9C50]] for the outline's.
- **`bullet-gpu`'s glyph mask** is set in a named ink (`COVERAGE_INK`,
  `"white"`), which the design-tokens rule accepts. Only its alpha is read
  back. The pinpoint disable is gone.
- A DESIGN.md line O4a wrote over 100 characters is rewrapped.

## O4c–O4f: what landed

The graph is an optional family of two packages, on by default. Six
`refactor:` commits, behaviour-preserving except where O4e decided otherwise
and for the seed's view order (both below).

### O4c: the graph's reads and writes go through the kit

- **`WorkspaceBoundary` and `OntologyPicker` are kit components**
  (`@kb/ui-sdk`), with their tests. `SidebarNavItem` and
  `listOntologyItems` were the kit's already.
- **The ontology members** come through `usePageGraph`, not the app's
  graph store.
- **The graph's three writes leave core's `mutations`, `plan` and
  `PageWrites`.** They are the zone's own (`lens-writes.ts`) over
  `browserHost().writes`, and no graph file names `mutations`:
  - `setLensProp` and `setGraphRenderer` are `replaceField` of one field;
  - `saveGraphPerspective` is the new generic `PageWrites.addViewNode(text,
    props)`, a view node with given props filed in the Views list. It is
    named for what it does, not for the graph. `planAddViewNode` was
    already generic. *Superseded by the
    [review follow-up](#o4-review-follow-up): `addViewNode` is gone, and
    the save goes through `view.propose`.*
  - `planSetGraphRenderer` and `planSetLensProp` are gone.

### O4d, second half: the lens and the seed are the graph's

- **`lens.ts` moves whole into `@kb/graph`.** All of it was the graph's:
  the slot table, `LensPerspective`, the defaults, the settings schemas,
  `decodeLensConfig`, `encodeLensConfig`, `perspectiveProps` and
  `sourceValue`. It reads the subject's slots through `@kb/views`' newly
  exported `SUBJECT_SLOTS`.
- **The graph's ids are `GRAPH_IDS`** (`@kb/graph`'s `ids.ts`), with their
  spelling kept: every lens field but the subject's two, the graph sources
  and their kind field, and `lens.all-mentions`. `lens.query` and
  `lens.focus` stay in `SYSTEM_IDS`, because every view reads them.
- **`graph-schema.ts` is `@kb/graph`'s `schema.ts`**, and the graph's seed
  nodes are `graphSeedNodes`, which the graph's declaration seeds.
- **Two core migrations name graph ids by their spelling.** They migrate
  graph data written before the graph was a family, so they cannot import
  it:
  - the seed's legacy rename of `sys.lens.all-mentions` is now a table,
    `LEGACY_SEED_RENAMES`;
  - the view migration names the field a perspective named its renderer
    in, `PERSPECTIVE_RENDERER_FIELD`.

  `@kb/graph`'s seed test holds both to `GRAPH_IDS`. See the placeholder
  below.
- **A raw colour leaves a component module.** The grey that a `fixed:`
  colour source draws in when it names no colour is now a lens default,
  `DEFAULT_FIXED_COLOR`.

### O4e: decided, and what landed

The owner took the recommendation above.

- **The lab reaches the graph through `LensGraphService`.** The kit names
  the service: the lens graph of a perspective, or of the default one.
  - Its shape is the kit's `LensGraph`, whose edge promises only its two
    ends (`LensGraphEdge`).
  - The graph's browser half provides it, from its one extraction.
  - The zone's own `GraphLens` extends the kit's shape with the
    projection's `LensEdge`.
  - The lab injects the service, so its studies wait, pending, while the
    graph is off. *Superseded by the
    [review follow-up](#o4-review-follow-up): only Sky waits, and the
    service is the kit's `NodeLinkGraphService`.*
  - `@kb/lab-ui` and `@kb/ui-sdk` no longer depend on `@kb/graph`.
- **The extraction moves out of the kit.** `graph-lens.ts` and its two
  tests are the graph's browser half's.
  - Its pure helpers stay beside it: no server reads them, so a split
    would have no second reader.
  - `queryNeighbourhood` stays in the kit. It is a generic query helper
    like `queryBacklinks`: its EDN is `@kb/query`'s, and it names no type
    of the graph's.
- **The ontology names the graph's page by its id** (`graph.page`, through
  the page catalog's `keyOf`), so it imports nothing of the graph.
  - With no key held, the tab shows the "cannot be shown here" state, by
    the option's label (`viewNamed`).
  - That state moves from the layout's node view into the kit
    (`ViewUnavailable`, `ViewNotLoaded`), so both surfaces say it the same
    way.

### O4f: the cut

- **`@kb/graph`** (`packages/extension/graph`, `scope:shared`,
  `family:graph`) holds:
  - `graphExtension`: optional and on by default, with its seven views (the
    page, the five renderers, the neighbourhood) and its seed;
  - `graphPlugin()`, the server's entry, and a child of the page's.

  Core's declaration lists none of the graph's views and folds no graph
  seed. `@kb/operations` no longer depends on `@kb/graph`.
- **`@kb/graph-ui`** (`packages/extension/graph-ui`, `scope:browser`,
  `family:graph`) holds:
  - the old `components/graph` zone and its tests;
  - the two graph stories, with their own smoke test;
  - the d3-force-3d shim, which travels with its one importer by a
    triple-slash reference, as `@kb/query`'s datascript shim does.

  Its entry, `graphUiPlugin`, is named for the declaration, loads
  `graphPlugin()` and provides `LensGraphService`.
- **Registration.** The graph comes second, after the outline, in
  `BUNDLED_FAMILIES`, in the server's entries and in the page's resolver
  (a static `load`, from the main bundle). `CORE_UI_PLUGINS` no longer lists
  it, and the graph zone is gone from `UI_SURFACES` and `UI_ALLOWS`.
  `extensionContract` covers it as it covers every bundled family. The
  page's switch case in `ui-plugins.test.ts` now lists the graph, and a new
  case holds the lab pending while the graph is off.
- **The barrel stays inside the lazy fence.** It names the entry and only
  what the page's tests read:
  - the lens extraction and the frame type, which the entry loads already;
  - the 3D light arithmetic.

  It names no renderer. Exporting the page or the 3D scene for a test pulled
  three into the entry's chunk, and `ui-lazy-fence.test.ts` caught it.
- **Three page tests stay in `@kb/ui`**, under `src/page-tests/graph/`:
  - the page and a node's neighbourhood, over the shell's graph store. The
    page is now drawn through a slot for the graph's view, so its lazy
    chunk loads as it does in the app. Their `vi.mock`s name the package's
    modules by path: seven in the page test, one in the neighbourhood test;
  - the 3D light, checked against the shell's design-system sheets.

  The shell's lens and ontology tests read the barrel too.
- **`@kb/ui` drops the renderer dependencies** it no longer imports
  (sigma, graphology, d3 and `@kb/scene-gpu`). The lint ratchet's knip
  entries follow their files, and three dead exports are drained.

### The seed's view order changed

`sys.views` lists the graph's seven options after the outline's and before
the canvas's. They used to be core's first ones. The seed golden was
regenerated, and that children order is its only change. A store opened
before this keeps its order.

### Behaviour that changed, as O4e decided

- The lab, switched on, waits while the graph is off: it shows nothing of
  its own until the graph's browser half is loaded. *Superseded by the
  [review follow-up](#o4-review-follow-up): the lab loads and offers
  every study but Sky, which waits.*
- An ontology's graph tab, with the graph off, shows "This view cannot be
  shown here" by the option's label. Before, it showed a "Graph not found"
  page.

### Tests that changed meaning

- **The graph's writes:** `actions/lens-renderer.test.ts` tested the two
  plan builders. As `lens-writes.test.ts`, it tests the three writes over a
  test host's write port.
- **The lens cases** of `@kb/views`' config, round-trip and subject tests
  move to `@kb/graph`'s `lens.test.ts`. The graph seed test moves to
  `@kb/graph`, and gains the lens fields' cardinality and type cases.
- **Core tests that used a graph field as their example now use a core
  one:**
  - the store contract's single-valued field (`view.pagesize` on the
    approval policies view);
  - the cardinality and field-type cases;
  - the outline's single-value stack;
  - `@kb/query`'s view queries, which name `lens.all-mentions` by spelling;
  - the view-migration tests, which name the legacy fields by spelling.
- **The renderer contract** runs in `@kb/graph-ui` over the test host
  instead of the shell's host.
- **The disc layout test** runs over the seeded graph instead of the
  offline fixture graph.
- **The 3D graph's scene contract** runs beside its scene. `@kb/ui`'s scene
  contract keeps the lab's studies.
- **The graph page test** draws the page through a slot for `graph.page`,
  not as a bare component.
- **The extension contract's canvas case:** the option before the canvas's
  is the graph's neighbourhood. `kb ext list` lists `graph`.
- **`ui-plugins.test.ts`:** the page loads the graph as a family, second.
- **`screen.test.ts`:** the case that names a view node's view loads the
  graph's shared plugin beside core's declaration, where core's declaration
  used to hold the graph's keys.
- **The lazy-fence and UI-boundary fixtures** name a layout file instead
  of the graph zone, which is gone.

### Gaps

- **Closed: GAP [[01M52YKFN18S0PJR2PHHM5QTXZ]].** Core no longer imports
  the graph's keys. The marker is gone from `core-extension.ts`. The `#gap`
  node is left for the coordinator to close.
- **New placeholder: GAP (placeholder): the graph's page tests run in the
  shell.** This is the outline's GAP [[01M531QT1YPM9NTF6NKH9BP66S]], for the
  graph.
  - expected: a family half's tests hold it to `BrowserHost` through the
    test host (DESIGN-UI → Extension UI halves).
  - current: three graph tests run from `@kb/ui`'s `src/page-tests/graph/`.
    The page and neighbourhood tests drive the shell's graph store, and
    mock the package's modules by path. The light test reads the shell's
    design-system sheets. The barrel exports what they read.
  - impact: the barrel is wider than the entry, and these tests cannot run
    in the package.
  - closes: the page and neighbourhood tests rewritten over the test host,
    the light test reading the sheets through the kit, and the barrel
    narrowed to its entry.
- **New placeholder: GAP (placeholder): core's migrations name the graph's
  frozen ids.**
  - expected: a family declares the migrations of its own legacy data, as
    it declares its seed.
  - current: `LEGACY_SEED_RENAMES` and `PERSPECTIVE_RENDERER_FIELD` in
    `@kb/model` spell `lens.all-mentions` and `sys.f.lens.renderer`.
    `@kb/graph`'s seed test holds the spellings to `GRAPH_IDS`.
  - impact: two spellings of two ids, bridged by a test rather than by an
    import.
  - closes: a declaration-level legacy rename (GAP
    [[01M3FK1PM9P96SNCSHXF0CJZRA]], the seed's general retirement) and a
    family-declared view migration.
- **Unchanged:** the outline's page-test gap, and the node menu's order
  placeholder.

## Outline cut review follow-up

Sol's batched review of the outline cut asked for eight fixes. Each landed
as its own commit, before O5.

1. **One definition of a test file.** `isUiTestFile` is
   `isPackageTestFile` over `@kb/ui`'s `src`. The zones that hold test code
   only, `test-support` and `page-tests` (`UI_TEST_ZONES`), have no row in
   `UI_ALLOWS`.
   - A production file in one is a breach.
   - A production row that names one is what holds their importers to tests.
   - `ui-boundaries.test.ts` fails if the two definitions diverge, and if a
     test zone holds a production file.
2. **The outline's entry injects the host.** Tests that load it into a
   kernel of their own load the shell's host first.
3. **Core surfaces write through the host.** The ontology list, page and
   section, and `lib/commands`, now write through `browserHost().writes`.
   `browser-host.ts` is the one binding of `mutations`. The graph zone's
   four importers were O4c's, which removed them.
4. **No page test asserts writes against the stubs.** None of the 37 page
   tests uses the ui-test-kit's test host or its `INERT_WRITES`: they take
   only `installDomGlobals` from it, and they write through the shell's
   host.
5. **The ontology names no view.** Its scope opens in the store's default
   view type (`resolveDefaultViewType`). With no such view held, it shows
   the kit's `ViewNotLoaded`, as the graph's tab does, where it used to show
   a "not found" page. The outline's keys still stay in
   `@kb/views`, for the frame-view reason recorded under the move.
6. **`update-cost` mocks through the kit's entry.** It mocks the row chrome
   through `@kb/ui-sdk`'s entry, after O5's first step moved the row chrome
   into the kit. A row reaches it there.
7. **The fixture path is current, and the hex rule covers the halves.** The
   design-tokens fixture names a `components/` file that exists. The hex
   rule now also holds a `.tsx` module of a family's browser half:
   components moved into a flat `-ui` package had escaped it.
8. **The minted ids are cited.** The plan cites the two minted gap ids, and
   the long comment lines are rewrapped.

## O5: the collections family

The table, board and cards frame views left the outline as one family,
**collections**: `@kb/collections` (shared) and `@kb/collections-ui`
(browser).

- **One family.** The three share the frame config, the frame layout
  (filters, sort, columns, groups), the row chrome and the cell parts. The
  board and the cards share one component.
- **Optional, and on by default.**

### What is the outline's, and what the kit's

- **The frame host is the outline's.** That is the view that shows a
  frame's rows inline, edits each row's text and fields, and keeps how many
  pages are revealed. The outline keeps the list (its own rendering), the
  frame mechanism (`FrameViewSlot`, the toolbar, the filter popover) and the
  keyboard walk.
- **The kit holds what the frame views of both families read.**
  - `frameRows`, the frame layout and the row chrome.
  - The frame-view hooks.
  - `FrameSubject`: what a host hands a frame view. That is the frame, plus
    the host's `RowText`, `Field`, `pages` and `revealMorePages`.
  - `NoFrame`.
  - `BrowserHost` gains `isSelected`, `toggleCollapse` and the
    `useIsSelected` hook. `PageEditorState` gains `toggleCollapse`.
- **One constructor.** The outline builds the subject once
  (`outlineFrameSubject`).

### The keys

The keys move to `@kb/collections` as `CollectionTableView`,
`CollectionBoardView` and `CollectionCardsView`.

- They are made by `frameViewKey`, now exported from `@kb/views`. Their
  page is the outline at the frame.
- **Their ids are frozen** (`outline.table`, …). The page finds a provided
  view by contribution id, and a plugin's contributions are namespaced by
  the plugin. So each collection view is contributed with its key's id as
  an alias (the kernel's compat shim), and `findView` matches an alias as
  well as the id.
- The view contract's stand-ins provide under the key's own id, in the root
  namespace.

### Steps

1. `refactor: a frame's rows, layout and row chrome are the kit's`.
2. `refactor: a frame view lays out rows its host edits, through the kit's
   frame subject`.
3. The move: the packages, the keys, and the registration.
   - **Registration:** in `BUNDLED_FAMILIES`, the server's entries and the
     page's resolver, after the outline and before the graph in each, with
     a static `load`. The collections come before the graph because their
     views are frame views the outline hosts.
   - **Seed golden regenerated:** the only change is `sys.views`' children
     order. The outline's snippet now sits before the table, board and cards
     options, which sit before the graph's.

4. `feat: a frame whose view is switched off says it cannot be shown here`.
   This is the one behaviour change.
   - Before: a frame whose view node named a view not provided fell back to
     the list, with a warning.
   - Now: it shows the kit's "This view cannot be shown here" state
     (`ViewNotLoaded`), named by the view's option node, and the keyboard
     walk offers it no rows. That state, which the node view and the
     ontology's graph tab already use, is drawn at its slot's placement: a
     workspace state at `page`, one line at `inline`. Every caller names
     its placement.
   - A frame that names no view still shows the list.
   - The view node stays, and the view returns with its family
     (`collections-off.test.tsx`).

### Tests

- **Moved to the family:** `@kb/views`' board and table cases moved to
  `@kb/collections`' `tests/views.test.ts`. Core's catalog and kit tests now
  use the list and the outline's own keys.
- **Plugin loads:** page tests that need the table, board or cards load
  `collectionsUiPlugin` beside the outline's.
- **Rendering a view directly:** a test that renders a view directly hands
  it the outline's frame (`outlineFrameSubject`).
- **Expectations that now include `collections`:** the families-to-load
  lists, `kb ext list` and the switchable list. The extension contract's
  canvas case is unchanged: the option before the canvas's is still the
  graph's neighbourhood.

### Gaps

- **Cited:** the collection views' barrel exports, the views the page tests
  render, cite GAP [[01M531QT1YPM9NTF6NKH9BP66S]], now widened to every
  family half's page tests (outline, collections, graph).
- **The view-as command nodes are core's seed:** GAP
  [[01M536CGS8JJ7XMG3F738WSNYK]], marked where core's seed declares them.
  - expected: `sys.cmd.view-as-{list,table,board,cards}` (`SYSTEM_IDS`) are
    the families' seed.
  - current: core's `systemSeedNodes` seeds all four, and the pickers name
    them through `SYSTEM_IDS`.
  - impact: a family switched off leaves its command node seeded, as data.
  - closes: each family seeds its own command node, under an id it owns.
- **Core's seed holds a collection view:** GAP
  [[01M536CH4P48SXV9B0HH8B4XTG]], marked on the seed node. The approval
  policies view node (`view.approval.policies`) names `outline.table`.
  - current: with the collections off, the frame shows that it cannot be
    shown here.
  - Not closed: no core view type shows the policies without loss. The list
    reads only filters, so the three columns, their widths and the page size
    would go. The store's default view type is a page view, not a frame
    view, so it cannot lay out a frame's rows.

## O4 review follow-up

The second review of the graph cut found seven things to fix, each now its
own commit on `o4-review-followup`.

- **Only the lab's graph study waits for the graph.** The lab no longer
  injects the graph's service. Its studies are offered at a lab point
  (`LabStudyPoint`). A study that reads the graph (`LabStudy.readsGraph`,
  only Sky) is offered by a child plugin of the lab that injects the
  service, so it is the only one pending while the graph is off. The lab
  page names a study that waits as waiting for the graph.
  `ui-plugins.test.ts` asserts that with the graph off the lab offers every
  study but Sky, and offers Sky once the graph is on.
- **A proposed graph view sets its lens.** Every renderer's params compose
  `LensParams` beside the settings it reads. `LensParams` holds the query,
  focus, hops, edge kinds, node budget and mappings, each optional. So
  `view.propose` can set which nodes a graph view draws.
  - This closes GAP [[01M40X30Q8N7NYCYHW3J0GFKY7]]. Its marker is gone, and
    the `#gap` node is left for the coordinator to close.
  - `saveGraphPerspective` proposes a view node of the active renderer
    through `browserHost().proposeView`, with the params that renderer
    declares (`rendererParamsOf`).
  - `PageWrites.addViewNode`, the unchecked second path, is deleted.
  - Changed behaviour: a saved copy holds only its renderer's params, so a
    tree copy no longer carries spread or link distance.
- **The kit says no graph.** The kit's service is now the shape its reader
  reads, in `lib/node-link.ts`:
  - `NodeLinkNode`: id, label, degree and cluster key;
  - `NodeLinkEdge`, `NodeLinkGraph`, and `NodeLinkGraphs.ofView(…, viewId)`;
  - the service key `NodeLinkGraphService` (`"ui.node-link"`).

  `@kb/graph-ui` owns the full `LensNode`, which extends `NodeLinkNode`, and
  `GraphLens`. Four kit comments that named the graph are generic now.
- **The ontology's graph id has one home.** `@kb/views` holds
  `ONTOLOGY_GRAPH_VIEW`, beside `ONTOLOGY_VIEWS`, and `@kb/graph`'s views
  test holds it equal to `GraphView.id`. With the graph off, the tab names
  the view by the label the catalog gives it, else by its id: no literal.
- **Core's seed test names no graph id.** The fill-absent case over All
  mentions moves to `@kb/graph`'s seed test. Core's version keeps sys.tag
  and uses the approval policies' table view.
- **Stale references fixed:**
  - `CORE_UI_PLUGINS` in DESIGN-UI;
  - the `edges.ts` path in DESIGN;
  - `app/ui/ARCHITECTURE.md`;
  - a test name in `force3d-labels.test.ts`;
  - a query source in `schema-compat.test.ts`;
  - `node-update-props.test.ts`, which now uses core's views.
- **The graph-ui barrel's test exports carry
  GAP [[01M531QT1YPM9NTF6NKH9BP66S]].** That gap now covers every family.
- **Left as is: core's migrations name the graph's frozen ids**, the
  placeholder above. The family could declare the rename table, but
  `PERSPECTIVE_RENDERER_FIELD` is read by core's view migration, and that
  migration is the graph's own logic. So a declared rename would close only
  half of it. Both halves wait for the declared retirement table, GAP
  [[01M3FK1PM9P96SNCSHXF0CJZRA]], with a hook for family migrations.

## Sol's review of O5 and the graph cut

Sol reviewed `511186d3..868221d1` (O5) and `76017abb..72f613df` (the graph
cut), recorded as kb todo `01M539CJ4YH39Y0TM6WY6CEN23`. Each fix is its own
commit.

1. **One test of a frame's view node.** `frameViewNodeOf` (`@kb/ui-sdk`'s
   `lib/frame-view.ts`) is the one reader: the frame's slot, its walk, its
   toolbar and its writes all go through it. `useFrameView` no longer
   applies an `isViewNode` check of its own. That check was dead, because
   `familyViewIdOf` picks only a node whose `sys.f.view` names an option of
   the frame family. The two cases are now explicit:
   - **No frame view node:** the frame names none, or only nodes that name
     no frame view, such as a node with no `sys.f.view`. It shows the list.
     `node-config.policy.test.ts` covers both forms.
   - **A frame view node naming a frame view not provided:** it shows
     "cannot be shown here" and offers no rows.
