# kb: moving feature code out of core into extensions

Plan of 2026-10-04, for the owner's expectation: "everything still lives in
its own extension". A Sonnet audit found that only partly true. The server
extensions (`@kb/agent`, `@kb/agent-claude`, `@kb/ext-canvas`,
`@kb/ext-docs`, `@kb/ext-check`) and the sandbox engines are real packages,
but chart, code, lab, canvas and the agent's UI are hardwired into core
packages. This file decides the clean shape and the order of the move. It
builds on [DESIGN.md → Core boundary & extensions](../../../tools/kb/DESIGN.md#core-boundary--extensions)
and on the [plugin-composition brief](../../kb/waves/2026-09-24/briefs/plugin-composition.md)
(phases R1/R2), and does not restate either. Once the owner signs it off,
this file is the home of these decisions until DESIGN.md absorbs them (step
E1). **E1 has landed:** the contract is now stated in
[DESIGN.md → Extension families](../../../tools/kb/DESIGN.md#extension-families)
and [DESIGN-UI.md → Extension UI halves](../../../tools/kb/DESIGN-UI.md#extension-ui-halves).
Where this file and those sections differ, those sections win. This file
keeps the reasons and the build order.

*Revised the same day after a review against the code.* Eight findings are
folded in, each marked "changed" or "added after review" where it lands:
- the seed fold is the bundled list, not a loaded registry, and there is no
  `SeedPoint`;
- every `systemSeedNodes()` caller is named;
- the view-type order changes once, at E4b, not at E9b;
- the page's catalog is derived from `kb.manifest.views`;
- `label` and `family` move onto `ViewKey` in E4, and `VIEW_VALUES` goes
  with them;
- the in-app UI plugins load each moved shared plugin as a child;
- "optional" is a server-side load decision;
- the E6 fence lists the breaches it starts with;
- the `family:` tag is checked equal to the declared name.

**In one paragraph.** An extension is a *family* of packages that share one
name. Each package has exactly one scope, as the harness already requires.
The shared package holds the family's vocabulary: ids, view keys, seed
nodes and how its views read as text. A browser package holds its UI, and a
backend package holds anything that needs Bun. Each host (the server
registry and the browser kernel) loads one entry plugin per family, and both
entries are built from the same shared plugin, so the two halves cannot
drift. The server registry is the one list of which extensions are on, and
the browser follows it. Three things that are core tables today become
contribution points: the seed, the view catalog, and a view's text. Ids keep
their exact spelling. Only their owner moves, so no store migrates and
opening still never writes. The harness gains a family axis and a
composition-root fence, so the boundary is `enforcement: harness`, not
prose.

## What the audit found, by place

| # | Where | Feature code in core | Already a gap |
|---|---|---|---|
| 1 | `@kb/ui` (`app/ui`) | `components/{chart,code,lab,agent,canvas}`, `src/agent.ts`, `lib/chart-data.ts`, ~15 `lib/canvas-*` modules. "Add chart" sits in the shell's `lib/commands.tsx`. The package depends on `@kb/agent` and `@kb/vega`. Lab and agent are statically imported although they are off by default | canvas only: `01M39F3MR3HT2NR553FY8CRD6X` |
| 2 | `@kb/views` | `chart.ts`, `code.ts`, `lab.ts` and `canvas.ts` sit in `VIEW_CATALOG` | — |
| 3 | `@kb/model` | `SYSTEM_IDS.{chartField, codeField, codeGrantField, canvasField, canvasTag}` and their nodes in `systemSeedNodes` | canvas only |
| 4 | `@kb/model` | `VIEW_VALUES` (`view-node.ts`) | `01M3YM5XYZ4VHEK39RNQ6WWRPK` |
| 5 | `@kb/query`, `@kb/operations`, `@kb/contracts`, `@kb/sandbox` | `chartRecords` (`records.ts:43`), `chart-text.ts`, `code-text.ts`, `VIEW_BODIES` in `view-markdown.ts:71`, the `ChartSvg` port (`contracts/src/chart.ts`), the `CodeSnapshots` port | — |
| 6 | `@kb/runtime` | `layers.ts` provides `ChartSvg` from `vegaChartPainter` and builds `codeSnapshots` over `quickjsEngine` | — |
| 7 | `@kb/ui` | the agent's UI half | — |

Most of this is invisible today: only rows 1 (canvas) and 4 carry a gap.
Step E0 mints the rest ([Gaps to mint now](#gaps-to-mint-now)).

## Decisions

### What an extension is

1. **An extension is a family of packages, one scope each. It is not one
   package with two entries.**
   - Why: the scope fence is per package. A package's tsconfig preset follows
     its `scope:*` tag (`RUNTIME_PRESET_BY_SCOPE`), and so do the
     isomorphism fence and `SCOPE_ALLOWS`. A package with a `./server` entry
     and a `./ui` entry would need a scope per entry. That is a second
     boundary model beside the first. Gap `01M39F3MR3HT2NR553FY8CRD6X`
     already decided "never one package with two entries", and this plan
     keeps that decision. **Owner question 1.**
   - A family has up to three packages. Each sits flat under
     `packages/extension/`, because `workspace-shape` allows one folder level:

     | Package | Scope | Holds | Loaded by |
     |---|---|---|---|
     | `@kb/<family>` | shared | its document or model, ids, view keys, seed nodes, text bodies, and the **shared plugin** that contributes them | both hosts, as a child of their entry |
     | `@kb/<family>-ui` | browser | its views, routes, sidebar section, docks and commands, built against `@kb/ui-sdk` | the browser |
     | `@kb/<family>-<adapter>` or `-server` | backend, or shared when isomorphic | actions, and adapters such as Vega or the Claude SDK | the server |
   - **Family identity is data.** Each extension-layer package carries an
     `nx` tag `family:<name>`. It is not a duplicate of the folder: the layer
     says *where* a package sits and the family says *whose* it is. This is
     the "canonical package-family identity" that gap
     `01M3F923QWH9HSAW61VNFWHANV` asks for.
   - The families after the move:

     | Family | Shared | Browser | Server-only |
     |---|---|---|---|
     | chart | `@kb/chart` (new) | `@kb/chart-ui` (new) | `@kb/chart-vega` (today's `infrastructure/vega`, moved to `extension/`) |
     | code | `@kb/code` (new) | `@kb/code-ui` (new) | — (the engines are core; see decision 7) |
     | lab | `@kb/lab` (new; key and seed only) | `@kb/lab-ui` (new) | — |
     | agent | `@kb/agent` (exists) | `@kb/agent-ui` (new) | `@kb/agent-claude` (exists) |
     | canvas | `@kb/canvas` (exists; gains keys, ids and seed) | `@kb/canvas-ui` (new) | `@kb/ext-canvas` (exists) |
     | docs, check | — | — | `@kb/ext-docs`, `@kb/ext-check` (exist) |
   - Renaming `ext-canvas`, `ext-docs` and `ext-check` to the `<family>-*`
     form is optional. The `family:` tag carries the identity, so a rename is
     a cosmetic chore and no step waits on it.
   - `@kb/canvas` stops having zero dependencies: its keys need `@kb/views`
     and `effect`. The other choice is to make `@kb/ext-canvas` shared and put
     the vocabulary there. That would put inert canvas actions into the
     browser kernel, so this plan does not take it.

2. **Each host loads one entry per family, and both entries are built from
   the shared plugin.** `@kb/<family>` exports a plugin factory, for example
   `chartPlugin({figure?})`. The server's entry and the browser's entry are
   two calls to it plus their own contributions, so a key, a seed node or a
   text body cannot differ between the hosts.
   - Server entry for chart: `chartServerPlugin` in `@kb/chart-vega`. It is
     `chartPlugin({figure: vegaFigure})`, so the extension registers its own
     painter (decision 7).
   - Browser entry: `chartUiPlugin` in `@kb/chart-ui`. It is `chartPlugin()`
     as a child (`ctx.plugin`) plus `ViewPoint`/`CommandPoint` contributions.
   - Families that have no server-only package (code, lab) use
     `@kb/<family>`'s plugin itself as the server entry.
   - This is the same pattern as `agentPlugin({runtime})`, and it keeps the
     kernel's rule that a plugin's scope owns everything it registered.

3. **One registry decides what is on; the browser follows it. The two lists
   are bridged, not mirrored.**
   - **The server registry is the list.** `BUNDLED_PLUGINS` becomes
     `BUNDLED_EXTENSIONS`, each entry being a family's server entry, in
     `app/runtime/src/bundled.ts`. The agent stays composed by the CLI for
     `kb ui` only, because it needs a runtime and the Claude SDK. The `kb ui`
     server adds the host plugins it loaded (the agent) to the same report.
   - **`kb.manifest` gains `extensions`**: `[{name, label, optional, source}]`.
     `kb ext list` already prints this; now the page can read it.
   - **Each family declares itself once.** `defineExtension({name, label,
     optional?, seed?})` in `@kb/<family>`. Every entry plugin takes its
     `name` from the declaration, and so does the manifest row.
     `BROWSER_EXTENSIONS` is keyed by the imported declaration's `name`, never
     by a typed string, and the `family:` tag (decision 10) is checked equal to
     it. So the declaration is the one home of the name, and the tag and the
     resolver key are readings of it.
   - **Optional is a server-side load decision.** A family the person
     switches off is not loaded by the server registry, so its views leave
     the catalog. Its seed nodes are still seeded, because the seed fold is
     the bundled list and not the loaded one (decision 4). Each
     `kb.manifest.extensions` row reports `enabled`. Lab has no server
     package, so without this its "off" would be a browser preference while
     the server still lists `lab.page`, which is the two-switch problem again.
     The Preferences row writes the server-side setting, not local prefs, and
     the browser follows the manifest. Where that setting lives (a node, since
     everything is a node) is decided in E10. This is a behaviour change, so it
     lands in E10b with the agent dock.
   - **The browser holds a resolver, not a second list.** Today's
     `BUILTIN_UI_PLUGINS` and `OPTIONAL_UI_PLUGINS` hold core UI plugins and
     feature UI plugins side by side. After the move:
     - `CORE_UI_PLUGINS` holds outline, graph, ontology, layout, webmcp and
       screen;
     - `BROWSER_EXTENSIONS: Record<family, {load: () => Promise<Plugin>}>`
       maps a family to its browser entry;
     - `syncUiPlugins` converges the kernel on: core, plus the browser entry
       of every family the manifest reports and the resolver has, minus any
       `optional` family switched off in `enabledPlugins`.
   - **One `load` shape for every source.** A bundled family's `load` is an
     import, eager for families that are always on and `import()` for
     optional ones. Later, a repository extension's `load` fetches its built
     ESM. That closes gap `01M39F3N04WNEVCGHX428H8TKN` through this same
     entry, not through a second loader.
   - **What this fixes:** the agent today has two switches, `--no-agent` on
     the server and the preference in the browser. After the bridge, a page
     served without the agent does not offer the agent dock. That is a
     behaviour change, so it lands as its own commit.
   - **The harness checks the pairing:** every extension package must be
     imported by the composition root of each host its scope runs in
     (decision 10). A family whose UI package nobody loads is caught as a
     dead seam.

### Vocabulary: ids, seed, views

4. **The seed belongs to the family, and ids keep their exact spelling.**
   - **The seed fold is the bundled list, never a loaded registry.**
     `ensureSystemSeed` runs in `openKbEffect` before any registry exists
     (`layers.ts`), and it must stay that way. Folding "what the registry
     loaded" would pull `.kb/extensions` discovery into every open; a failed
     load would silently shrink the seed; and `kb ui` adds the agent later
     than `kb add` does, so the two would seed differently. So:
     - each family declares its system nodes as the `seed` of its
       `defineExtension` declaration;
     - `bundledSeed()` folds core's nodes, then each `BUNDLED_EXTENSIONS`
       declaration's `seed`, in bundled order. It is pure data and opens
       nothing, and it fails on an id declared twice. The
       `extensionContract` proves that it does;
     - host plugins (the agent) and repository plugins contribute no seed.
       There is no `SeedPoint`: a point open to every plugin would be a wider
       door than the one list that may seed. *(Changed after review: the
       first draft folded a `SeedPoint` over the loaded registry.)*
   - `ensureSystemSeed(nodes, at, seed)` takes the seed set as a parameter
     instead of calling `systemSeedNodes`. `openKbEffect` passes
     `bundledSeed()`.
   - **Every caller of `systemSeedNodes()` is named and moves in E4.**
     `systemSeedNodes()` becomes core's nodes only. Each caller that means "a
     fresh store as kb ships it" switches to `bundledSeed()`:
     - `domain/model/src/example.ts`;
     - `app/test-kit/src/{harness,store-benchmark}.ts`;
     - `app/ui/src/api/fixture-graph.ts`, `app/ui/src/fixtures/view-fields.ts`
       and `view-contract.test.tsx`;
     - the render-tests fixtures and server;
     - about twenty further tests across `domain/model`, `domain/query`,
       `app/runtime`, `app/server`, `app/cli`, `app/client` and `app/ui`
       (`rg -l systemSeedNodes` lists them).

     The UI fixtures read the same fold, so `bundledSeed()` lives in a
     `scope:shared` module beside the list's declarations. Only the server
     entries need Bun, and those are resolved per declaration in
     `bundled.ts`. E4 picks that module.
   - **Ids are frozen data.** `sys.f.chart`, `sys.f.code`, `sys.f.code.grant`,
     `sys.f.canvas`, `sys.tag.canvas` and every `sys.view.<id>` keep their
     spelling. Only the declaring package changes: `CHART_IDS` lives in
     `@kb/chart`, and so on. `SYSTEM_IDS` keeps core's ids.
   - **No store migrates, and opening still never writes.** Three tests prove
     it:
     1. A seed golden, committed in step E4 before anything moves: the fresh
        seed as a node set keyed by id, each node whole, so a parent's
        `children` order is part of it. Every later step keeps it
        byte-identical, except for one deliberate change (below), which lands
        straight after E4.
     2. A new `store-contract` case: a store written by the pre-move seed
        opens under the post-move registry with zero writes (it reuses
        `openingNeverWrites`).
     3. Another case: opening with a family unloaded neither deletes nor
        rewrites that family's nodes. The data outlives the code, as
        DESIGN.md → View nodes already says of options.
   - **The one fresh-store difference.** Today the `sys.views` children
     follow `VIEW_VALUES` order, which interleaves core views and feature
     views. After the move the fold gives core first, then the families in
     bundled order. `ensureSystemSeed` only appends missing children (`adopt`,
     `seed.ts:757`), so existing stores are never reordered. A fresh store
     lists view types in the new order. **Owner question 4** (accepted).
     - The order changes **once, in step E4b, straight after E4**, while
       everything is still core: `corePlugin` contributes its views core
       first, then the feature views grouped by family in `BUNDLED_EXTENSIONS`
       order. The golden changes in that commit only.
     - Each later move (E7, E8, E9) then takes a family's group out of core
       and into the family at the same place in the fold, so the golden,
       child order included, stays byte-identical. *(Changed after review:
       the first draft put the order change at the end, as E9b, but chart and
       code leaving core at E7 and E8 would each have reordered the children
       on the way.)*
   - **Renames and retirements stay out of this plan.** If an id must ever
     change, it goes through the retirement table of gap
     `01M3FK1PM9P96SNCSHXF0CJZRA`, or through an explicit action like
     `views.migrate`. It never happens on open.
   - **Repository extensions** (`.kb/extensions`) do not seed, for the
     reasons above. If they ever must, that is a decision of its own about
     the ext-sdk surface, and its mirror is gap `01M1PJWF4G6W4122ZE4K67319V`.

5. **The view catalog is a point. This is the core view port.**
   - **`ViewKeyPoint`** (`kb.views`, in `@kb/contracts`) holds `ViewDef<P> =
     {key: ViewKey<P>, text?: ViewText<P>}`, one contribution per view, keyed
     by the view id. A family lists its `ViewDef`s as the `views` of its
     declaration, and its shared plugin contributes exactly those.
   - `label` and `family` move onto `ViewKey` **in E4**, so `VIEW_VALUES` and
     the keys never sit side by side as two sources. `@kb/model` cannot read
     `@kb/views` (the dependency runs the other way), so `VIEW_VALUES` cannot
     become a reading of the keys. It is deleted in E4 instead, and its
     readers move to `key.label` and `key.family`: the seed (through
     `bundledSeed()`), `graph/plugin.ts`, `view-node.test.ts` and
     `view-queries.test.ts`. Gap `01M3YM5XYZ4VHEK39RNQ6WWRPK` stays open
     until E9, when the last feature key leaves core.
   - The `sys.views` option nodes derive from the declared keys inside
     `bundledSeed()` (decision 4), not from a loaded registry. A view's option
     is therefore never declared twice.
   - A **`ViewCatalog` service** replaces every read of the `VIEW_CATALOG`
     constant: `view.propose`, `kb.manifest.viewCatalog`, `catalogKeyOf` and
     the view contract.
     - On the server it is provided from the registry kernel.
     - In the browser it is **derived from `kb.manifest.views`**, which
       already serves the server's catalog (`operations/src/manifest.ts`). The
       page kernel holds the key objects, because decoding params needs code,
       and the page's catalog is those keys restricted to the ids the
       manifest lists. A key the page holds that the manifest lacks is
       reported, never listed. So there is one catalog, read on the server
       and bridged to the page, and the isomorphic `view.propose` checks
       against the server's list. *(Changed after review: the first draft
       read the page kernel as a second catalog.)*
   - **What stays core in `@kb/views`:** `view-key.ts`, `view-node.ts`, the
     catalog mechanism, and the core views (outline, graph, ontology, frame,
     lens, node route, layout, docs). See decision 8.
   - **What this fixes:** today the catalog lists `lab.page` while the lab
     plugin is off by default, so an agent can propose a view that no loaded
     plugin draws. After this decision the catalog lists only what is
     loaded.

6. **A view's text is part of its contribution.**
   - `view-markdown.ts` already keeps a local registry, `VIEW_BODIES`, that
     pairs `ChartView` with `chartBody` and `CodeView` with `codeBody`. That
     registry becomes `ViewDef.text = {body, figure?}`.
   - `viewText` looks up the catalog by view id and falls back to the
     generic body. Core keeps only the generic body, the heading and the
     subject listing.
   - `chart-text.ts` moves to `@kb/chart`, together with `chartRecords` and
     `MAX_CHART_ROWS` from `@kb/query`. `queryRecords` stays core, because it
     names any query's rows.
   - `code-text.ts` moves to `@kb/code`.
   - One function, `renderViewNodeEffect`, still serves `render.view` and
     `ui://kb/view/*`.

### Painters and engines

7. **A painter belongs to the view that paints with it. An engine belongs to
   the core port it implements.**
   - **Chart.** The `ChartSvg` port exists only because core's `chart-text`
     could not import Vega. Once the text body lives in the chart family, the
     painter becomes the figure that `chartServerPlugin` hands to
     `chartPlugin({figure})`. `ChartSvg` leaves `@kb/contracts`, and
     `layers.ts` stops importing `@kb/vega`.
     - The browser entry passes no figure, so the browser's isomorphic
       actions still draw text only, as today.
     - The page still draws charts by `import()`ing `@kb/chart-vega` behind
       the same two lazy boundaries (`UI_LAZY_DEPTH`).
   - **Sandbox.** The port, both engines, the frame bundle and the page host
     (`lib/sandbox-host.ts`) are core mechanism: the task names
     `contract/sandbox` core, and scripts (roadmap decision 5) will use the
     same sandbox. The engines are its adapters, bound by composition roots
     the way stores are, and `sandboxContract` is their shared suite.
     - `@kb/runtime` and the `@kb/ui` frame build keep their engine
       dependencies.
     - **What moves is the code view's policy.** `codeSnapshots` (a
       read-only invoke, then `snapshotRun`) leaves `layers.ts` and becomes
       the figure in `@kb/code`'s text.
     - That figure asks a core reference, `UntrustedEngine`, for the engine.
       The runtime provides it as `quickjsEngine`; the browser provides
       none, which draws text only, as today. `CodeSnapshots` leaves
       `@kb/sandbox`.
   - No `RuntimeLayerPoint` or other generic service point is added. Neither
     chart nor code needs one, and a point with no real user is a dead seam.

### What stays core

8. **Core stays mechanism plus the projections the shell is built from.**
   DESIGN.md records this classification in step E1. None of it is drift, so
   none of it gets a gap:
   - **Layout.** The pane tree is the workspace itself: `App.tsx` renders
     `Workspace`, the URL names the focused pane, and `workspace.store` and
     the save and close commands are built on `LayoutTree`. Moving it out
     would make the shell depend on an extension, or would need a "workspace
     point" with one fallback, which is a second path. `layout.grid`,
     `layout.node` (`resolveNodeView`), `sys.f.layout` and dockview stay.
     **Owner question 2.**
   - **Outline, graph, ontology.** kb is a graph of everything, and these
     are the projections the shell opens by default (`resolveNodeView` falls
     back to `outline.main`). `graph.force3d` is a renderer in a core family.
     It could later become a third-party-style renderer extension, the first
     real test of contributing to someone else's family, once `@kb/scene`
     exists. **Owner question 2.**
   - **Docs views** (`docs.markdown`) are the render backbone that DESIGN.md
     names core. `@kb/ext-docs` owns the templates and actions, not the view
     type.
   - Also core: approval policies (`resolveApproval`), `view.propose`,
     `render.view`, `ui://`, the sandbox (decision 7), and the generic points
     (`ViewPoint`, `RoutePoint`, `SidebarSectionPoint`, `DockPoint`,
     `ChannelPoint`, and the new `CommandPoint`).

### UI halves and how they build

9. **A UI half is a workspace package that the shell's Vite build compiles
   from source.**
   - **No per-extension bundle is built for the bundled families.** Bun
     workspaces resolve `@kb/chart-ui` to its `src/index.ts`, and Vite splits
     at `import()` exactly as it does today inside `app/ui`.
   - What changes is the chunking of optional families. Lab and agent become
     `import()` chunks loaded when switched on; today their plugin modules
     are in the main bundle.
   - **`@kb/ui-sdk`** is the host API a UI half builds against. It is the
     package that gaps `01M3EZRFTS1W8SB97GFJAWD92X` and
     `01M39F3MR3HT2NR553FY8CRD6X` describe. It holds:
     - the UI points, `ViewSlot`, and the new `CommandPoint`;
     - the primitives (today's `primitives` zone) and the design tokens;
     - a `BrowserHost` kernel service, through which a half reaches what it
       uses today from `stores`, `actions` and `lib`. The shell provides
       that service; the sdk never imports the shell's stores.
     - The inventory sizes it. Chart, code, agent and lab together reach
       about 25 distinct shell modules. Canvas reaches about 25 more, plus
       its own ~15 `lib/canvas-*` modules, which move with it rather than
       into the sdk.
   - **`@kb/scene`**, the scene kit, becomes its own browser package. Canvas
     3D, lab and the core force3d renderer all stand on it.
   - **Where the sdk and the scene kit sit is a layer question.** Neither is
     a port adapter (`infrastructure`) or a domain use case (`application`).
     The plan proposes a new layer, `kit`: browser host libraries a plugin
     builds against. `kit` may reach `domain` and `contract`, and
     `extension` and `app` may reach `kit`. The alternative is to place both
     in `contract`. **Owner question 3.**
   - **The lazy fence follows packages.** `UI_LAZY_ONLY` is applied today to
     the import closure of `app/ui/src`. It must also walk into `scope:browser`
     workspace packages from `UI_ENTRY`. Otherwise moving the chart page out
     of `app/ui` silently exempts Vega from the fence.

### Enforcement

10. **The boundary is checked by the harness.** The changes to
    `tools/kb/harness/src/constraints.ts`:

    | Change | Rule | Red fixture |
    |---|---|---|
    | `family:<name>` tag | required on every `packages/extension/*` package (`workspace-shape`), and equal to the `name` its family's `defineExtension` declares, so the tag is checked against the one home of the name, not a third copy | an extension package without one; a tag that differs from the declaration |
    | Family edges | an extension package may import another extension package only of its own family. Closes `01M3F923QWH9HSAW61VNFWHANV`; the `LAYER_ALLOWS` GAP marker goes | ext-docs importing `@kb/canvas` |
    | Composition-root fence, `EXTENSION_ROOTS` | an `app` package may import an extension package from one named file only: `runtime/src/bundled.ts`, `ui/src/ui-plugins.ts`, and the CLI's agent host. Tests (`*.test.*`, `tests/`) are exempt, as in `UI_ALLOWS`. `@kb/ext-sdk` is the extension SDK, not a family, so the loader may import it | `layers.ts` importing `@kb/chart-vega` |
    | Pairing | every extension package is imported by the root of each host its scope runs in | a `-ui` package missing from `BROWSER_EXTENSIONS` |

    **The fence is red on arrival unless E6 marks what already breaks it.**
    These files import extension packages today, outside any root:
    - `ui/src/agent.ts` and `components/agent/*` (`@kb/agent`), which leave
      with E12;
    - `components/canvas/*` (after E3 this includes the former
      `lib/canvas-*`) and `catalog/canvas-card.stories.tsx` (`@kb/canvas`),
      which leave with E13;
    - `cli/src/bin/{check-audit,docs-check,docs-materialize}.ts`
      (`@kb/ext-check`, `@kb/ext-docs`), which either become named roots or
      reach their actions through the registry. E6 decides which.

    E6 lands each of these as a sanctioned breach carrying
    `GAP [[01M41H30Y60D3G9WJJX6NFQD2T]]`. The list shrinks as E12 and E13
    land.
    *(Added after review.)*
    | `SCOPE_ALLOWS.browser` | `["shared", "browser"]`, so a UI half can reach `@kb/ui-sdk` | — |
    | `kit` layer (if chosen) | `LAYER_ALLOWS.kit = [domain, contract]`; `extension` and `app` gain `kit` | — |
    | Lazy fence | walks browser workspace packages (decision 9) | a static `@kb/chart-vega` import in `@kb/chart-ui`'s plugin |
    | `UI_ALLOWS`, interim | a `sdk` zone (`app/ui/src/sdk`), the future package. Feature zones `components/{chart,code,agent,lab,canvas,canvas/3d}` shrink to `[self, sdk]`, plus `scene` for 3D and lab | a chart file importing `@/stores/outline.store` |
    | `UI_ALLOWS`, final | each zone is deleted when its package leaves, and `UiSurface` lists core surfaces only | the check's existing "row for a folder that is gone" |

    The boundary also gets one contract suite, **`extensionContract`**
    (`@kb/test-kit`), run over `BUNDLED_EXTENSIONS`. This is the
    one-contract rule applied to extensions. Every family must pass:
    - it loads and unloads cleanly, leaving nothing behind;
    - its seed ids have one owner, and `bundledSeed()` folds them without
      a registry (decision 4);
    - every view key it contributes has an option in the seed fold;
    - every text body renders its key's default settings;
    - the browser side: every view it contributes to the UI `ViewPoint` has a
      key in the page's catalog.

    A `#rule` node "core names no feature" (home: DESIGN.md → Core boundary,
    enforcement `harness`) is added in step E1 with `gate` naming step E6,
    and flips to `harness` when E6 lands.

## Build order

Every step lands green on `bun run verify && bun run test && bun run test:ui`.
Steps that touch figures or chart drawing also run `bun run test:render`.
A *restructure* changes no behaviour, and the suites that already pass prove
it. A *move* relocates code under a contract that already holds. A *change*
is a deliberate behaviour difference, kept in its own commit. S is about a
day, M a few days, L a week.

"3D" says whether the step conflicts with the 3D workspace plan's steps 4+
([plan](../2026-10-02-kb-3d-workspace/README.md)). Those steps touch
`app/ui/src/components/canvas/*` (especially the `*3d*` files),
`lib/canvas-*` and `extension/canvas`.

| # | Step | Kind | Size | 3D |
|---|---|---|---|---|
| E0 | Mint the gaps below, put `// GAP [[id]]` at each deferral site, and widen `01M3YM5XYZ4VHEK39RNQ6WWRPK` | chore | S | none |
| E1 | Spec first: DESIGN.md → Core boundary states families, host entries, the bridge, the bundled seed fold, `ViewKeyPoint` with `text`, the painter/engine rule and the core classification (decision 8); DESIGN-UI states the resolver and `@kb/ui-sdk`; add the `#rule` node | docs | S | none |
| E2 | **sdk zone:** carve `app/ui/src/sdk/` (UI points, `ViewSlot`, `CommandPoint`, `BrowserHost`, primitives). Restrict the chart, code, agent and lab rows to `[self, sdk]`. Move `lib/chart-data.ts` into chart's zone and "Add chart" into the chart plugin through `CommandPoint` | restructure | M | none |
| E3 | **canvas zone:** move the `lib/canvas-*` modules into `components/canvas/`, and restrict the canvas and canvas/3d rows to `[self, sdk, scene]` | restructure | M–L | **yes**: it rewrites every canvas import |
| — | *3D step 4 may resume here* | | | |
| E4 | **Points:** add `defineExtension` (with `seed` and `views`), `bundledSeed()`, `ViewKeyPoint` and the `ViewCatalog` service (derived from `kb.manifest.views` in the page). `label` and `family` move onto `ViewKey`, and `VIEW_VALUES` is deleted. `corePlugin` contributes today's whole seed and catalog. `ensureSystemSeed` takes `bundledSeed()`, and every `systemSeedNodes()` caller is moved (decision 4). Commit the seed golden, child order included, and the two store-contract cases | restructure | M | none |
| E4b | Fresh-store view-type order: core views first, then feature views grouped by family in bundled order. The golden changes here, once (decision 4) | change | S | none |
| E5 | **View text:** `VIEW_BODIES` becomes `ViewDef.text`, and `viewText` reads it from the catalog (the bodies are still in operations, contributed by core) | restructure | S | none |
| E6 | **Harness:** add `family:` tags, the family-edge rule, `EXTENSION_ROOTS` (`bundled.ts` split out of `registry.ts`), the pairing check, `SCOPE_ALLOWS.browser`, and an `extensionContract` skeleton over docs, check, canvas and agent | restructure | M | tags only in `extension/canvas/package.json` |
| E7 | **chart family:** create `@kb/chart` (key, spec, `chartRecords`, text, ids, seed). `infrastructure/vega` moves to `extension/chart-vega` with `chartServerPlugin`. `ChartSvg` leaves contracts and `layers.ts` drops Vega. The in-`app/ui` chart plugin loads `chartPlugin()` as a child (`ctx.plugin`), so the moved key still reaches the page kernel before E12 | move | M | none |
| E8 | **code family:** create `@kb/code` (key, grant, text, ids, seed, and the snapshot figure over `UntrustedEngine`). `CodeSnapshots` leaves `@kb/sandbox`, and `layers.ts` keeps only the engine. The in-`app/ui` code plugin loads `codePlugin()` as a child | move | M | none |
| E9 | **lab and canvas vocabulary:** create `@kb/lab` (key and seed). Canvas keys, ids and seed move into `@kb/canvas`, which closes the seed half of `01M39F3MR3HT2NR553FY8CRD6X`. The in-`app/ui` lab and canvas plugins load their shared plugins as children. The last feature key leaves core, closing `01M3YM5XYZ4VHEK39RNQ6WWRPK`. `SYSTEM_IDS` is now core only | move | M | low: canvas imports change from `@kb/views` to `@kb/canvas` (about 8 files) |
| E10 | **Bridge:** add `optional` to `defineExtension`, `kb.manifest.extensions` (with `enabled`) and the `BROWSER_EXTENSIONS` resolver keyed by declaration name; `syncUiPlugins` follows the manifest. Decide where the server-side on/off setting lives | restructure | S–M | none |
| E10b | The agent dock is offered only when the server runs the agent, and an optional family (lab) is switched on and off on the server, not in browser prefs | change | S | none |
| E11 | **Packages:** `@kb/ui-sdk` from the sdk zone and `@kb/scene` from the `scene` zone (layer per owner question 3); the lazy fence walks packages | move | M | low: an import-path rewrite in canvas/3d, mechanical |
| E12 | **UI halves:** `@kb/chart-ui`, `@kb/code-ui`, `@kb/agent-ui` and `@kb/lab-ui` (one commit each). Their zones leave `UI_ALLOWS`, and `@kb/agent` and the Vega dependency leave `@kb/ui`'s manifest | move | S each | none (disjoint from canvas) |
| E13 | **`@kb/canvas-ui`** from `components/canvas` (including 3D). Closes `01M39F3MR3HT2NR553FY8CRD6X` and lets `01M3EZRFTS1W8SB97GFJAWD92X` close | move | M | **yes**: a path move, mechanical after E3 |
| E14 | Close the gaps, flip the rule's enforcement to `harness`, `docs.materialize` | chore | S | none |

E4–E12 have no order constraint with 3D steps 4–10 beyond what the table
shows, so they can run in parallel worktrees with 3D work.

**Note from the doing (E2).** In E2 the sdk zone is two files: a barrel,
`src/sdk/index.ts`, and `BrowserHost`, `src/sdk/host.ts`. It is not yet
the full contents.
- The points, the primitives and the pure helpers that the barrel names
  keep their code in `lib/`, the primitives zone and `ds/`. They move behind
  the barrel in E11, so E11 is a move with no change to callers, and a
  feature's imports only change from `@/sdk` to `@kb/ui-sdk`.
- So the sdk row reaches `primitives`, `lib` and `ds`, and never `stores`
  (GAP `01M3EZRFTS1W8SB97GFJAWD92X`).
- `CommandPoint` sits beside `Command` in `lib/commands.tsx` for the same
  reason.
- Everything that touches the shell's state goes through `BrowserHost`:
  stores, writes, the invoke path and the sandbox host. The host is a
  subscribe, reads and gestures, never hooks. The first draft handed out
  hooks, and the React lint rightly flagged them as selected at run time.
  The sdk's own hooks are built over the host with `useSyncExternalStore`.
- Where a core hook and the host need the same rule, the rule moved into
  one function that both call: `appearanceIn`, `followFrom`, `refInkIn`,
  `sidebarOpenIn` and `toggleSidebarFrom`. `OpenNodeContext` moved from
  `stores/` to `lib/follow`, because it is a React context and not a
  store.
- The shell provides `BrowserHost` from a built-in plugin, and the feature
  plugins inject it.

**Note from the doing (E3).**
- The canvas's `lib/` modules are `canvas-*`, `card-pointer` and
  `shape-label-edit`. They now live in `components/canvas/`, and the 2D and
  3D rows are `extensionRow`s.
- Pane screens report through one hook, `usePaneScreenThrough` in
  `lib/pane-screen`, over a port. The screen store and the host are its two
  bindings.
- `listCanvasNavItems` left `lib/sidebar-nav`.
- **One sanctioned breach remains.** The kb-node card drives the outline's
  `NodeTextHost` with `useNodeTextHostBinding`, which reads stores through
  tracked graph reads, caret hand-off and the text-host registry.
  Rebuilding it over `BrowserHost` is a design of its own, so the import
  carries `GAP [[01M41MHRD7MF4NP23EE294B69C]]`, closed with `@kb/ui-sdk`
  (E11). Everything else the card does goes through the host.

**Note from the doing (E4).** Where the plan said "E4 picks", or was
silent, this is what was picked:
- **The shared module is a package, `@kb/bundled`** (`app/bundled`,
  `scope:shared`). It holds `BUNDLED_DECLARATIONS`, core's declaration
  first, and `bundledSeed()`. A family's shared declaration joins that list
  in E7–E9. The fold itself, `foldSeed`, is `@kb/model`'s mechanism, so
  the option node shape stays with `viewOptionId`. It places the options
  right after `sys.views`, which keeps even the seed's array order. So E6's
  `EXTENSION_ROOTS` gains `bundled/src/index.ts`, beside `bundled.ts` and
  `ui-plugins.ts`, and `bundled.ts` resolves a server entry per declaration.
- **Core is declared too.** `coreExtension` (`@kb/operations`) holds the
  seed and the whole catalog. Its server entry is `corePlugin` (actions)
  with `declarationPlugin(coreExtension)` as a child. The page loads
  `declarationPlugin(coreExtension)` from `BUILTIN_UI_PLUGINS`.
- `ensureSystemSeed(nodes, seed)` has no `at`, because the seed is already
  stamped. `isPristine(nodes, seed)` takes the seed too. DESIGN.md says so.
- **Tests reach the fold through the harness, not a re-export.** A barrel
  may not re-export another package. So domain tests import `@kb/bundled`
  the way they import `@kb/test-kit`: `TEST_WORLD_PACKAGES` in
  `constraints.ts` names both.
- `ViewKey.family` is typed `ViewFamily`. `ViewPicker.label` is gone,
  because a picker reads `key.label`, which made the copy a mirror.
- **The page before a server answers.** An offline page on its fixtures,
  or one whose `kb.manifest` has not arrived, is its own server. Its
  kernel's keys are its catalog (`lib/view-catalog.ts`). `ViewCatalog`
  joins `IsomorphicActionEnv`, because `view.propose` reads it.
- **The golden is order-sensitive** and byte-identical through E4 and E5.
  E4b, the order change, is not done here.

**Note from the doing (E4b).** The order is fixed by the moves, not by
taste. Core's declaration is folded first, so while a family's views are
still in core they come before every family that has already moved. For
the golden to stay byte-identical, the family that leaves core first must
sit last. So the feature views follow core's as canvas, lab, code, chart:
- chart (E7) joins the end of `BUNDLED_FAMILIES`;
- code (E8) joins just before chart;
- lab (E9) joins after canvas and before code, and canvas's views follow
  canvas, which is already in the list.

Existing stores keep their order. A store-contract case opens a store with
`sys.views` in another order, and it writes nothing and keeps that order.

**Note from the doing (E5).** `ViewText` is `{body, figure?}`, two
functions of the decoded params, as the spec states. So a chart's page
figure runs its query a second time, once per html render. `viewDef(key,
text?)` pairs a key with a text of the same params type.

**Note from the doing (E6).** Where the plan said "E6 decides", or was
silent, this is what was picked. It was revised after a review of the first
commits, and this text is the reviewed shape.
- **Every family declares itself now, not at its move, in its shared
  package.** Without a declaration the `family:` tag would have nothing to
  equal. Docs and check had no shared package, so each gained one,
  `@kb/docs` and `@kb/check`, holding only the declaration. Canvas declares
  in `@kb/canvas`, which gains `@kb/contracts` early, and agent in
  `@kb/agent`. Every entry plugin reads its name from the declaration,
  including the page's agent plugin, and `AGENT_PLUGIN` is gone; a test
  pins the wire channel to `agent.chat`, so a rename cannot move it
  silently.
- **One bundled list.** `BUNDLED_FAMILIES` in `@kb/bundled` (`scope:shared`)
  is it; the seed folds core then those declarations. `runtime/src/bundled.ts`
  holds only the server entries, and `serverEntriesFor` pairs each family
  with the entry of its name, failing at load on a family with no entry or
  an entry with no family. The first draft kept a second
  `{declaration, entry}` list there, a mirror the review caught. A bundled
  family can only declare in a shared package, because the page folds the
  same list.
- **The roots** are `runtime/src/bundled.ts`, `cli/src/host-plugins.ts`
  (the CLI's agent wiring, moved out of `cli.ts`), `ui/src/ui-plugins.ts`,
  and `bundled/src/index.ts`, which imports each family's shared package
  for its declaration and loads nothing. A root may not re-export an
  extension package.
- **The breaches are named files.** `EXTENSION_ROOT_BREACHES`, under
  `GAP [[01M41H30Y60D3G9WJJX6NFQD2T]]`, lists each file that may import a
  feature and the one feature it may import: the agent UI (E12), the canvas
  UI with its story (E13, about 45 files), and the three CLI bins. A file
  not named fails, and a named file that stops importing fails, so the list
  is frozen and can only shrink, like a ratchet's baseline. Per-line
  markers were not used because the canvas alone has about 50 import
  lines, past the ~30-site limit. The first draft listed folders, which
  sanctioned any future file there; the review caught it. A new canvas file
  that imports `@kb/canvas` must be added here until E13.
- **The CLI bins stay sanctioned breaches, not roots.** They already invoke
  through the registry. They import only the family's output schema, to
  print the report. That report is feature policy in core, so the bins are
  neither roots nor fixed by the registry route. The gap's `closes` says
  they leave once the family's report reaches them through the registry.
- **Pairing counts value imports only.** A type-only import loads nothing.
  A `scope:shared` package runs in no host on its own, so it pairs when a
  root of a host loads it or a loaded package of its own family imports it
  (`@kb/canvas` through `@kb/ext-canvas`).
- **The declared name is read fail-closed.** Only a direct call
  `defineExtension({ name: "…" })` counts. An aliased import, a member call,
  a computed or spread key, or the function passed as a value fails.
- **Test files** are the package's own `tests/` and `tests-render/` folders
  and `*.test.*` files; a `tests/` folder inside `src/` is production code.
- **The rule node took a `#check`.** `ext.check.audit` derives enforcement
  from a check node and refuses a gate beside it. So promoting "Core names
  no feature" to `harness` needed a new `Check: extension families` node
  (harness, `bun run harness`, `extension-families.test.ts`) and removing
  the rule's `gate`. Its principle states only what the check proves; the
  browser's bridged list (E10, E12) and core's remaining feature vocabulary
  are named there as not checked yet.
- **`extensionContract` says what it can prove.** It holds each entry to its
  declaration's name, to a clean load and unload, and to contributing
  exactly the views its declaration lists. Its seed and view-option
  promises run over empty sets today, because no family declares seed or
  views yet; it says so under the seed and view gaps, which close at E7–E9.
  The text-body and page-catalog promises join at E7. The agent's run lives
  in `@kb/cli`'s tests, beside its host.

## 3D sequencing

3D step 3 (solids, Milestone 1) landed on main at `bad8a5c7`, and no 3D
branch is open. This is the cheapest moment the canvas will ever have for a
restructure. Each of steps 4–7 adds canvas files (the gizmo bridge, the modal
state machine, groups, the text overlay), and each would otherwise be
written against `stores`, `actions` and `lib/canvas-*` and have to be
rewritten later.

**Recommendation:**
- **Do E0–E3 before 3D step 4 starts.** That is a few days. E3 is the only
  step that rewrites canvas imports. After it, new 3D code is born
  extension-shaped, because the harness lets it reach only `sdk` and
  `scene`.
- **Do not block 3D on the rest.** E4–E12 touch the canvas at most by an
  import path (E9, E11) and can interleave with 3D steps 4+.
- **Land E13 (the physical canvas move) at a 3D step boundary,** once E11
  has made `@kb/ui-sdk` a package. After E3 it is a rename plus an import
  rewrite (`@/sdk` → `@kb/ui-sdk`), which git's rename detection carries
  through a rebase. Do it no later than Milestone 2 (after 3D step 7), so
  the canvas does not grow two more steps inside `@kb/ui`.
- 3D step 8 (agent verbs) lives in `@kb/canvas` and `@kb/ext-canvas` on the
  server side and is unaffected.

## Gaps to mint now

The drift is visible before the move lands. E0 minted these; each id
stands beside its gap, and the text is as minted, review corrections
included. They are new `#gap` nodes
(`kb add "GAP: …" --tag gap --create --prop expected=… --prop current=…
--prop impact=… --prop closes=…`), each with markers at the sites named in
`current`.

**Update, not new: `01M3YM5XYZ4VHEK39RNQ6WWRPK`.** The catalog keys and the
option seeds are one concept, so this gap is widened rather than given a
twin.
- *expected:* each plugin that provides a view contributes its key to the
  server's view point, and `VIEW_CATALOG` and the `sys.views` options are
  readings of that point.
- *current:* add "`VIEW_CATALOG` in `@kb/views` lists the same views by key".

The new gaps:

1. **GAP: extensions cannot contribute seed nodes; the chart and code fields
   are core system ids** (`01M41H2Z7B5GCJXHCRYBS7M3YH`)
   - *expected:* each extension contributes its system nodes to a seed point
     under their frozen ids; core's seed holds core vocabulary only; and
     `ensureSystemSeed` seeds the fold of what the root's registry loaded.
   - *current:* `SYSTEM_IDS` (`model.ts`) and `systemSeedNodes`
     (`seed.ts:363-366`) declare `sys.f.chart`, `sys.f.code` and
     `sys.f.code.grant`. `ensureSystemSeed` reads only the core table. No
     point takes a plugin's seed. Canvas is covered by
     `01M39F3MR3HT2NR553FY8CRD6X`.
   - *impact:* every feature edits `@kb/model`, and a store seeds a feature's
     fields whether or not its extension is loaded.
   - *closes:* the `BUNDLED_EXTENSIONS` seed fold (`bundledSeed()`, decision
     4) passed to `ensureSystemSeed`, with `systemSeedNodes()` core only, and
     a committed seed golden; then each family's ids and nodes move into its
     shared package.
2. **GAP: a view's text projection is a branch in core's viewText** (`01M41H2ZG7C0SV1DYZE6MMKPFE`)
   - *expected:* a view's text body and figure are part of the view's
     contribution, looked up by view id, and `@kb/operations` keeps only the
     generic body.
   - *current:* `view-markdown.ts` imports `ChartView` and `CodeView` and
     pairs them with `chartBody` and `codeBody` in `VIEW_BODIES`.
     `chart-text.ts` and `code-text.ts` live in `@kb/operations`.
   - *impact:* a view extension cannot say itself in text without editing
     core, and core carries chart-table and code-fence policy.
   - *closes:* `ViewDef.text` on the view point, read by `viewText`; the two
     bodies move to their families.
3. **GAP: the runtime binds feature painters and snapshot policy in
   kbRuntimeLayer** (`01M41H2ZS8FH55DCW3S9ZGPWPY`)
   - *expected:* the chart family's server entry supplies its own figure;
     the code family draws its snapshot through a core engine reference; and
     `layers.ts` binds only core ports.
   - *current:* `layers.ts` provides `ChartSvg` with `@kb/vega`'s
     `vegaChartPainter` and builds `CodeSnapshots` (`codeSnapshots`, a
     read-only invoke) over `quickjsEngine`. `ChartSvg` is a chart port in
     `@kb/contracts`, and `CodeSnapshots` is a code-view port in
     `@kb/sandbox`.
   - *impact:* `@kb/runtime` depends on Vega; a painter or snapshot change
     edits the composition root; and a new view with a figure has nowhere to
     register it.
   - *closes:* `chartPlugin({figure})` from `@kb/chart-vega`; the code
     snapshot as `@kb/code`'s figure over `UntrustedEngine`; `ChartSvg` and
     `CodeSnapshots` deleted.
4. **GAP: feature view models live in core packages** (`01M41H30342XZPX3CXZJTMPBYW`)
   - *expected:* `@kb/views` holds the view-key mechanism and core views,
     and the chart, code, lab and canvas keys and helpers live in their
     family's shared package.
   - *current:* `domain/views/src/{chart,code,lab,canvas}.ts` ship in
     `VIEW_CATALOG`, and `chartRecords` and `MAX_CHART_ROWS` are in
     `@kb/query` (`records.ts:43`).
   - *impact:* the catalog advertises `lab.page` while the lab plugin is off
     by default, so an agent can propose a view nothing draws; and every
     feature edits domain packages.
   - *closes:* the view-key point (with `01M3YM5XYZ4VHEK39RNQ6WWRPK`), then
     the moves into `@kb/chart`, `@kb/code`, `@kb/lab` and `@kb/canvas`.
5. **GAP: the chart, code, lab and agent UIs are zones of @kb/ui, not
   packages** (`01M41H30C2RSD2FGVYBT5HAG48`)
   - *expected:* each is the browser package of its family, built against
     `@kb/ui-sdk`, and `@kb/ui` holds the shell and core views only.
   - *current:* `components/{chart,code,lab,agent}`, `src/agent.ts` and
     `lib/chart-data.ts` live in `@kb/ui` and reach `stores`, `actions` and
     `lib` directly. `@kb/ui` depends on `@kb/agent` and `@kb/vega`. The
     shell's command table carries "Add chart". The optional lab and agent
     plugins are statically imported.
   - *impact:* adding or removing a feature's UI edits `@kb/ui`, feature code
     can reach any shell internal, and optional plugins ship in the main
     bundle.
   - *closes:* the sdk zone with restricted `UI_ALLOWS` rows, `@kb/ui-sdk`
     (`01M3EZRFTS1W8SB97GFJAWD92X`), then one `-ui` package per family.
     Canvas is `01M39F3MR3HT2NR553FY8CRD6X`.
6. **GAP: the server and browser plugin lists are not bridged** (`01M41H30N0SV4QE5R8VQQ1K4ZA`)
   - *expected:* the server registry is the one list of loaded extensions;
     the browser loads the browser entry of each extension the manifest
     reports; and the optional flag lives on the extension's declaration.
   - *current:* `BUNDLED_PLUGINS` (`runtime/src/registry.ts`), the CLI's
     agent wiring (`cli.ts`) and `BUILTIN_UI_PLUGINS`/`OPTIONAL_UI_PLUGINS`
     (`ui-plugins.ts`) each name extensions on their own. The agent has two
     switches, `--no-agent` and the `enabledPlugins` preference.
   - *impact:* an extension can be on in one host and off in the other with
     nothing reporting it. The agent sidebar can be switched on against a
     server that runs no agent, which answers `unknown_channel`.
   - *closes:* `defineExtension` per family, `kb.manifest.extensions`, and a
     browser resolver keyed by family name.
7. **GAP: nothing confines feature imports to a composition root's bundled
   list** (`01M41H30Y60D3G9WJJX6NFQD2T`)
   - *expected:* an `app` package imports an extension package only from its
     one bundled-extensions file, and the harness checks it.
   - *current:* `LAYER_ALLOWS.app` admits every extension import from any
     file of an app package. Feature wiring sits in `registry.ts`,
     `layers.ts` and `ui-plugins.ts`, and also deep in `@kb/ui`'s
     components. "Core never names a feature" is prose.
   - *impact:* the next move out of core can silently regrow a hardwired
     import, and a feature can be wired from anywhere.
   - *closes:* `EXTENSION_ROOTS` in `constraints.ts`, with a red fixture.

After the move, the existing gaps to amend are:
- `01M39F3MR3HT2NR553FY8CRD6X`: its `closes` names `@kb/canvas`'s shared
  plugin as the seed's new home, not `@kb/ext-canvas` (decision 1);
- `01M3F8EJSWHS38PMSSQ2BVN8DG`: the interim rows of E2 and E3 are its
  inventory moment.

## Questions for the owner

1. **Family or one package?** Recommended: an extension is a family of
   packages with one scope each, tied by a `family:` tag. This keeps the
   recorded "one scope per package" decision. The alternative is one package
   with per-entry scopes, which needs per-entry tsconfig presets and
   per-entry import fences: a second boundary model.
2. **Layout and graph: core or extension?** Recommended: core. The pane tree
   is the workspace the shell is built on, and outline and graph are kb's
   default projections. `graph.force3d` is the first candidate to become an
   extension later, as a renderer contributed to a core family.
3. **Where `@kb/ui-sdk` and `@kb/scene` sit.** Recommended: a new `kit`
   layer for browser host libraries. The alternative is `contract`, which
   bends that layer's meaning (ports and shared vocabulary).
4. **Fresh-store view-type order.** After the move, a new store lists core
   view types first, then each family's. Existing stores are never
   reordered. Recommended: accept it.
5. **Sequencing.** Recommended: pause 3D for E0–E3 now (a few days), then
   interleave everything else, with the physical canvas move landing at a
   3D step boundary no later than Milestone 2.
