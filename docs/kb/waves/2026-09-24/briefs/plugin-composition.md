# plugin-composition — how one kb plugin uses another's views and services

A design proposal, not a decision. It needs no product code. It answers the
question: can a kb plugin embed another plugin's view (a canvas card showing a
live mini graph, a node showing its own 1…N-hop neighbourhood, a graph hover
showing an outline snippet) and call its services, with types checked end to
end, the way DeepSeek Harness does?

Short answer: yes. The kernel already has the typed half (keys, services,
points, scopes). What is missing is **one typed view point** that replaces the
page-shaped `SurfacePoint`/`ContributedSurface` pair, plus **view config held
as nodes**. Both follow from rules the repo already has, so this is a
restructure first and an addition second.

## 1. What exists today

**Kernel (`@kb/plugin`, `keys.ts` + `kernel.ts`).**

- Keys are typed names: `Service<S>()`, `Event<P>()` and `Point<C>()`. The
  type is a phantom (`"~type"?: T`). Keys are compared **by identity**: two keys
  with the same name are a `key-mismatch`, never an alias. The one place the
  kernel trusts a type is `asKeyType`.
- `provide`/`get` are **hard** dependencies. A plugin declares the keys it
  needs in `inject` and stays `pending` until every one is provided. It goes
  back to pending when a provider unloads.
- `contribute` is a **soft** dependency. Contribution ids are namespaced
  (`<ns>.<id>`) and unique per point, and readers get whatever is registered
  at that moment (`contributions`, `lookup`, `subscribe`/`version` for
  `useSyncExternalStore`).
- Children (`ctx.plugin`) unload with their parent. Everything a plugin
  registers belongs to its `Scope`, so unloading it undoes all of it, and a
  failed `apply` leaves nothing behind.

**Browser (`ui/src/lib/plugins.ts`).** There are two points: `SurfacePoint`
(`match`, `frame`, `pendingTitle`, `Chrome?`, `Component<{params}>`) and
`SidebarSectionPoint`. `syncUiPlugins` converges the kernel on the built-ins
plus the `enabledPlugins` preference. The five `components/*/plugin.ts` files
each contribute surfaces and a section, and nothing else.

**The one embed that exists, and why it doesn't scale.**
`components/ui/contributed-surface.tsx` renders another plugin's surface by id,
and the ontology uses it to show the graph and outline pages. It has three
problems:

- the id is a string literal (`const GRAPH_SURFACE = "graph.page"`), so a typo
  renders `null` without any error;
- params are `Record<string, string>`, so nothing checks what is passed;
- a surface is a *page*: it has a route matcher and a frame, but no size, no
  host placement, and no fallback when it is missing.

**Not used yet.** No UI plugin, and no extension, calls `ctx.provide` or
`ctx.get` outside the kernel tests. The graph's renderer registry
(`GRAPH_RENDERERS`) and the outline's view modes (the `ViewMode` union
list/table/board/cards, stored as a *text* `sys.f.view.mode`) are local
registries beside the kernel, not points.

**So what's missing:** a typed "render view X with params P, here, at this
size" contract; a way to ask for a view without importing it; config that
persists as data; and one test that every view must pass.

## 2. Proposed model

### 2.1 A view is the concept; a page is a route to a view

A graph page, a mini graph in a canvas card and a neighbourhood beside a row
are one concept: **a projection of the graph, rendered in a box the host
owns**. Rule 1 says that concept gets one point. Today it hides inside
`Surface`, fused with routing. Split it into two points:

```ts
// @kb/ui-sdk (scope:browser) — the host API a browser plugin may use
import type { Schema } from "effect";
import { Point, type PointKey } from "@kb/plugin";

/** A view's contract: its id and the params it renders from. The key is the type. */
export interface ViewKey<P> {
  readonly kind: "view";
  readonly id: `${string}.${string}`;          // namespaced, like every contribution
  /** Decodes a config node's props (and a code caller's input) into P. */
  readonly params: Schema.Schema<P, ViewConfigInput>;
  /** The option node that names this view in data (see §3). */
  readonly option: `sys.view.${string}`;
  readonly "~params"?: P;
}

export type Placement = "page" | "inline" | "beside" | "float" | "card" | "hover";

/** What a host guarantees a view: never a store, never ctx. */
export interface ViewHost {
  readonly placement: Placement;
  readonly size: { readonly width: number; readonly height: number };
  readonly appearanceKey: string;       // Appearance.key; a change means re-read tokens
  readonly reducedMotion: boolean;      // lib/motion.ts, asked once by the host
  readonly depth: number;               // nesting level, for the cycle guard
  readonly open: (id: NodeId) => void;  // navigation stays the host's decision
}

export interface ViewProps<P> { readonly params: P; readonly host: ViewHost }

export interface View<P> {
  readonly key: ViewKey<P>;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly placements: readonly Placement[];
  /** Contract-suite fixture: a params value every view must render. */
  readonly sample: P;
  readonly Component: React.ComponentType<ViewProps<P>>;
}

export const ViewPoint: PointKey<View<unknown>> = Point<View<unknown>>()("ui.views");

/** A route resolves a path to a view and its params; it owns no component. */
export interface Route<P> {
  readonly view: ViewKey<P>;
  readonly match: (path: string) => P | null;
  readonly frame: "scroll" | "fixed" | "full";
  readonly pendingTitle: (params: P) => string;
}
export const RoutePoint = Point<Route<unknown>>()("ui.routes");
```

A surface is now `Route + View(placement "page")`. The shell renders the
matched route's view. `ContributedSurface` is gone, replaced by `<ViewSlot>`
below, so the ontology embeds the graph the same way a canvas card will.

### 2.2 Providing and asking, both by key

```ts
// components/graph/views.ts — the graph's view contracts; no React, no store
export const Neighbourhood = viewKey("graph.neighbourhood", {
  option: "sys.view.graph.neighbourhood",
  params: Schema.Struct({
    root: NodeIdSchema,                           // absent on the node → the host node
    hops: Schema.Literals([1, 2, 3, 4]),
    edges: Schema.Array(EdgeKindSchema),          // mention | child | ref-prop
    renderer: LensRendererSchema,                 // the seeded lens.renderer options
  }),
});

// components/graph/plugin.ts — the provider
ctx.contribute(ViewPoint, provideView(Neighbourhood, {
  minSize: { width: 160, height: 120 },
  placements: ["inline", "beside", "float", "card"],
  sample: { root: "n.root-a", hops: 2, edges: ["mention"], renderer: "force2d" },
  Component: NeighbourhoodView,                   // ComponentType<ViewProps<NeighbourhoodParams>>
}));

// any consumer — canvas card, outline row, graph tooltip
<ViewSlot view={Neighbourhood} params={{ root, hops: 2, edges: ["mention"], renderer: "force2d" }}
          placement="card" fallback={<NodeRow id={root} />} />
```

`provideView<P>(key: ViewKey<P>, v: Omit<View<P>, "key">)` builds the
`ContributionEntry` using the key's local id. `useView<P>(key)` does
`lookup(ViewPoint, key.id)`, then checks `contribution.value.key === key` by
identity. That check is the kernel's `claim`, applied to one entry, and it is
the only place `View<unknown>` is narrowed to `View<P>`, the same trust
`asKeyType` spends. `<ViewSlot>` owns everything the host must do: measure its
box, pass the `ViewHost`, wrap the view in `ViewErrorBoundary`, refuse to
render past `MAX_VIEW_DEPTH`, and show `fallback` when the view is absent.

**Views are soft, services are hard.** A view is a point, so a consumer never
goes `pending` because a view is missing: it renders the fallback. A
*computation* that another plugin must have is a service. For example, the
graph plugin could provide
`GraphProjection = Service<{ project(p: LensPerspective): LensGraph }>()("graph.projection")`
and the canvas could inject it to lay cards out by force. That makes the whole
consumer plugin pending while the graph is off, which is correct for a hard
dependency. Use the service form only when that is what you mean.

### 2.3 Params come from a query, not free-form props

A neighbourhood isn't a widget setting. It is a query:

```clojure
[:find ?id :in $ ?root
 :where [?r :node/id ?root] (reach ?r :node/mentions ?n 2) [?n :node/id ?id]]
```

`@kb/query` owns `neighbourhoodQuery(root, hops, edge)`, as it already owns
`backlinksQuery`. The view renders `query → {nodes, edges} → renderer`, which
is the same pipeline the graph page uses (`graph-lens.ts`). So `P` is **a graph
perspective narrowed to a focus and a hop bound**. The fields already exist
(`sys.f.lens.focus`, `lens.renderer`, `lens.edge-kinds`), plus one new field,
`sys.f.lens.hops`. A mini graph is a smaller box on the same projection, never
a second graph model.

Caveat: `reach` is directed. An undirected 1…N neighbourhood is the union of
the two directions, and even that misses mixed-direction paths (a→b←c).
Writing the union as one query needs `or`, which drops the query to `raw`
today (GAP [[01M39X8RPQBWFVDNG77BB3ZCMH]]). Until that gap closes, the view
runs the two directed queries and unions the results, and names the gap at
that site.

### 2.4 Type safety, end to end

Keys are the runtime truth. `SlotMap`-style declaration merging is the
**type-level index derived from the keys**: a bridge, not a second registry.

```ts
// @kb/ui-sdk
export interface ViewMap {}                         // augmented, never hand-listed
export type ViewId = keyof ViewMap & string;

// graph's views.ts (built-ins) — or generated into .kb/sdk.d.ts (repo extensions)
declare module "@kb/ui-sdk" {
  interface ViewMap { [Neighbourhood.id]: typeof Neighbourhood }  // id is a literal type
}
```

An in-tree consumer imports the key and gets the full types. A repository
extension, which can only see an ambient d.ts (the `kb-ext-sdk` precedent),
gets `ViewMap` in the generated `sdk.d.ts`. It then writes
`useViewById("graph.neighbourhood")`, which autocompletes the id and types the
params, and the host resolves the id to the key at load time.

| checked | when |
|---|---|
| the params a consumer passes; the props a component receives; the view ids in `ViewMap` | compile time (`tsc`) |
| key identity (`key-mismatch`); duplicate ids (`contribution-conflict`) | load time (kernel) |
| a config node decodes to `P` (`params` schema) | render time. On failure, the fallback names the field |
| a written value matches its field's type | write time, already enforced (`valueConformanceError`) |
| the view is present | render time. Absent means fallback, never a throw |

## 3. Everything is a node: the config is data

"Show a 2-hop graph beside this node" must persist, sync, show up in queries
and survive the graph plugin being off. So it is a node. Apply the strip test
from DESIGN.md → Kinds, roles and options:

- **A view config node is a kind carried by a field, not a tag.** A node with
  no view reference is just a node, the same argument that makes
  `sys.f.query` and `sys.f.ref.target` fields. The new field is `sys.f.view`
  (ref, single), and a node that carries it is a *view node*. Its other props
  are the view's params, using the lens fields plus `sys.f.lens.hops`. An empty
  `lens.focus` means "the node I'm rendered for", which makes one view node
  reusable as a template.
- **The allowed values are option nodes.** `sys.f.view` targets the children
  of a `sys.views` list node, one option per `ViewKey.option`
  (`sys.view.graph.neighbourhood`, `sys.view.outline.snippet`, …). The plugin
  that owns the view **seeds** its option node, derived from the key, following
  the canvas-split rule that a plugin owns its seeds. A plugin being unloaded
  never deletes the node, so the data outlives the code.
- **Placement is a field with option children.** `sys.f.view.placement`
  (ref) has the children `inline`, `beside` and `float`. `card` and `hover` are
  set by the host and never stored.
- **A host names its views by ref.** `sys.f.views` (ref, multi) on any node has
  `targetQuery` = nodes carrying `sys.f.view`. A view node that is a *child* of
  its host renders inline, like a query node that renders its results while
  expanded. No new storage shape and no new widget: a view node is edited as
  a row with fields, like any other node.
- **The outline's view modes join later.** `sys.f.view.mode` is a text field
  holding `list|table|board|cards`. The clean end state makes those four views
  over a frame's children, with `sys.view.outline.*` options. That move is
  named here as a gap, not bundled in (§6).

Transient views stay out of the graph: a hover card or a selection preview is
ephemeral, as the graph's search and selection already are. Those consumers
pass `P` from code, which the compiler checks. Only a view someone *chose* is
stored.

## 4. The contract suite

Per "One contract, every implementation", every view's promises live in one
suite, `view-contract.ts`. It runs over `VIEWS`, which is every `ViewPoint`
contribution made by loading all built-in and optional UI plugins into a test
kernel. A new view joins automatically, and a promise one view breaks turns the
suite red. For each view `v`, mounted with `v.sample` in each of
`v.placements`:

1. **Sizing.** It renders within `host.size` at `v.minSize` and at 4× that,
   and it re-lays out on resize without remounting. Geometry needs a real
   browser, so that part runs in `render-tests`; the structural half runs in
   the UI suite.
2. **Disposal.** After unmount, no instrumented resource is left:
   listeners, `requestAnimationFrame`, workers, WebGL/WebGPU contexts,
   store subscriptions.
3. **Appearance.** Changing `appearanceKey` re-reads tokens, so a
   token-derived value changes with no remount (the `GraphAdapterProps`
   precedent).
4. **Reduced motion.** With `reducedMotion: true`, no animation loop is left
   running after the first settled frame, and no camera tween runs.
5. **Unload.** Unloading the owning plugin while the view is mounted makes the
   `<ViewSlot>` show its fallback without throwing. Reloading brings the view
   back.
6. **Bad config.** A config node that fails `v.key.params` decoding renders
   the fallback naming the field, and never throws.
7. **Isolation and nesting.** A view that throws is contained by the slot's
   boundary, and the host stays up. Nesting stops at `MAX_VIEW_DEPTH`, so a
   view that embeds itself terminates.

Enforcement is `harness` once the suite exists. Until then, the rule is
`prose` and carries a `#gap`.

## 5. Worked examples

**A canvas card with a mini graph.** The canvas doc gets no new card type. The
user adds a `kb-node` card whose node is a view node:
`sys.f.view → sys.view.graph.neighbourhood`, `lens.focus → X`, `lens.hops = 1`.
`CanvasCard` already renders a node by id. It checks for `sys.f.view` (read
from its carrier, never from `node.tags`) and renders
`<ViewSlot view={byOption(node)} params={decode(node)} placement="card" fallback={<NodeRow …/>}/>`.
The card's resize handles set `host.size`. Turning the graph plugin off
leaves an ordinary node card. The canvas package never imports graph: after
the three-package split it sees only `@kb/ui-sdk`.

**A per-node N-hop neighbourhood, side by side or floating.** Node `A` has
`sys.f.views → V`, and `V` carries `sys.f.view → neighbourhood`, `hops = 2`,
`placement → beside`, with no focus, so the focus is whichever host renders it.
`NodeBlock` reads `sys.f.views` and lays each view out by its placement:

- `inline` renders it as a row under the node;
- `beside` renders it in the row's right gutter, on a wide layout only;
- `float` renders it in a pinned popover anchored to the bullet.

Changing the hop count is a field edit on `V`, so it syncs and undoes like any
other edit. Many nodes can reference the same `V`. "Every node of a kind"
could be done with tag templating, but that is a model decision (§6), not
something this proposal adds.

**The reverse: a graph hover shows the outline.** The outline plugin
contributes `outline.snippet` with `P = { root: NodeId; depth: 0 | 1 | 2; maxRows: number }`.
`graph-tooltip.tsx` renders
`<ViewSlot view={OutlineSnippet} params={{ root: hovered, depth: 1, maxRows: 6 }} placement="hover"/>`.
Because this is transient, the params come from code, not from a node. The
snippet can contain the view node from the previous example, which puts a
graph inside the outline inside the graph. `host.depth` bounds that nesting.
The mechanism is the same in both directions: neither plugin imports the
other, and each only knows the other's key.

## 6. Phased plan

Restructure, then add, as separate commits. Each restructure phase must keep
the existing suites green with no behaviour change.

| phase | kind | content |
|---|---|---|
| R1 | restructure | Split `Surface` into `ViewPoint` + `RoutePoint` inside `@kb/ui` (`lib/plugins.ts`). Add `ViewKey`, `provideView`, `useView` and `<ViewSlot>`. Replace `ContributedSurface` and its string ids with keys, with the ontology as the first consumer. Every page becomes placement `page`. |
| R2 | restructure | Move those types into the `@kb/ui-sdk` design. This is **part of the pending ui-sdk decision**, not beside it: the gap `01M39F3MR3HT2NR553FY8CRD6X` already says "the UI points", and this names them. |
| A1 | add | `sys.f.view`, `sys.views` (seeded by each owning plugin from its keys), `sys.f.view.placement`, `sys.f.views`, `sys.f.lens.hops`; `neighbourhoodQuery` in `@kb/query`; `view-contract.ts` with `graph.neighbourhood` and `outline.snippet` as its first members. |
| A2 | add | Outline placements (inline/beside/float), canvas `kb-node` cards that render view nodes, and the graph hover snippet. |
| A3 | add | `ViewMap` in the generated `sdk.d.ts` and repository-extension views. Waits on gap `01M39F3N04WNEVCGHX428H8TKN` (repo extensions can't ship UI). |
| later | gap | Outline view modes (`sys.f.view.mode`) and graph renderers (`GRAPH_RENDERERS`) as `ViewPoint` members. Filed as `#gap`, not bundled in. |

**The canvas three-package split.** Do R1/R2 before the canvas UI moves into
its browser package. That way the package is born consuming `<ViewSlot>` from
`@kb/ui-sdk` and never picks up a stringly `ContributedSurface` it would later
have to shed. The split becomes the first real test of the sdk boundary: the
canvas renders graph views while importing no graph code.

**What the user must decide:**

1. **The name.** This doc uses "view" (`ViewPoint`, `sys.f.view`). "Lens" is
   already taken by graph perspectives, and "embed" names the consumer's act,
   not the thing. The catch: `sys.f.view.*` is already the outline's
   view-config prefix. Accept that overlap, which is honest if view modes later
   become views, or pick another word.
2. **Where built-in keys live.** Identity keys require a *runtime* import of
   the key module, while DSH allows only `import type` across features. The
   proposal is key-only `components/*/views.ts` files with no React and no
   store, admitted by `UI_ALLOWS` the way `routes.ts` constants are. After a
   package split, a key moves to a tiny shared contract, as `@kb/canvas` does
   for the doc.
3. **"Every node" scope.** Choose per-node refs only (proposed), tag-level
   inheritance of `sys.f.views` (a new model rule), or one workspace default
   node.
4. **Neighbourhood direction.** Choose directed (outgoing), the union of both
   directions (proposed, two queries until `or` lands), or true undirected
   (needs a symmetric edge relation).
5. **Isolation.** Choose same-realm trusted views only (proposed, matching
   p1), with the iframe/MCP-Apps transport kept as a later option for
   untrusted views.

## 7. Comparison

| | kb (proposed) | DSH slots | VS Code | Obsidian / Logseq |
|---|---|---|---|---|
| **Typing of an embed** | Key object with a phantom `P` plus a runtime params `Schema`. `ViewMap` is derived by declaration merging | `SlotMap` by declaration merging (`declare module`). Components get composed typed props, never `ctx` | `package.json` contribution points are declarative JSON. `@types/vscode` types the API, not other extensions' views | Obsidian `registerView(type: string, …)`. Logseq macros `{{renderer …}}` are strings, and messages are untyped JSON |
| **Cardinality** | Keyed (unique ids per point). Many views per host by ref | `single \| list \| keyed \| chain` | Fixed per point (`views`, `commands`, …) | Keyed by type string |
| **Unload** | Scope close. The slot falls back, dependents of a *service* go pending, and the contract suite checks it | Cordis effect scope. The disposer collapses child slots recursively | `deactivate()`. Views go with the extension | Obsidian `onunload`. Logseq tears down the iframe; embedded macros show raw text |
| **Config as data** | View nodes and fields: queryable and synced, surviving unload | Runtime props at the `renderSlot` call site; not persisted | Settings JSON, separate from content | Obsidian code-block processors and Logseq macros keep config in note text: persisted, but stringly and not queryable as structure |
| **Cross-plugin embed** | First-class, by key, both directions | Through slots only; `import type` across features, never runtime | Not supported. Only a typed `exports` API if you import their d.ts | Obsidian: not official. Logseq: macros render into host blocks |
| **Isolation** | Same realm, trusted (like p1). iframe transport is a later option | None; one React tree | Separate extension host. Webviews are iframes | Obsidian: none. Logseq: sandboxed iframe |

Sources: DSH `docs/subsystems/slots.md` and
`packages/client/ui-slots/src/index.ts` (`export interface SlotMap {}`,
"Owners extend via declaration merging"; `SlotKind = 'single' | 'list' |
'keyed' | 'chain'`; `ctx.slots.register`/`ctx.slots.inject`). Note that
`docs/subsystems/client-modules.md` covers the bundle transport
(`dsh.client`, `exports["./client"]`, `window.__DSH_BOOT__`), not
composition. The kb file references are to `tools/kb` at `654f5b39`.
