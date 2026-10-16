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

## O2: what landed

Two restructures, each behaviour-preserving. The spec is
[DESIGN.md → View nodes](../../../tools/kb/DESIGN.md#view-nodes) (the
default view type) and → Layout views (the resolver bullet). This section
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
  ("cannot be shown here"). A missing or malformed default is reported
  through `ConfigReport` and resolves as a failure (see the gap below).
  `node-view.ts` no longer imports `OutlineView`.
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
  change once, and no later open writes. The seed golden was regenerated in
  this commit, as its header requires for a deliberate seed change.

Gap: `GAP [[O2-broken-view-ref]]` (placeholder). A broken view ref fails, and
the node route draws the failure as "Node not found". This covers a host
naming a view node that is gone, and now also a store whose default view
type is missing or names no view type. The report carries the warning, but
the pane says nothing true. Closes when `resolveNodeView` returns a named
broken-ref target that the node route draws as a `WorkspaceState`. The gap
has no `#gap` node yet, and the harness requires every code marker to name
one. So the placeholder appears only in prose here and in DESIGN.md. Once the
node is minted, the code marker belongs on the `named === null` failure in
`node-view.ts`.
