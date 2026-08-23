# R10 — graph deep study: what to steal from CodeFlow, for what, and how

Research-only. No `tools/kb/**` was modified; the only tracked change from this
brief is this report. Brief: `docs/kb-waves/2026-08-23/briefs/r10-graph-deep.md`.

## Method and evidence bound

- Admission gate: `./intent/gate.sh session claude` →
  `SOFT_MISSING: shellcheck actionlint nvfetcher` (exit 0).
- **The UI was actually run and driven.** A `kb ui` instance was served on
  `127.0.0.1:4322` against an **isolated data root** — `.kb` copied to the
  session scratchpad (187 nodes, the real repo data). Port 4321 was already held
  by another session's server pointed at the *tracked* `.kb` of
  `/Users/popemkt/.dotfiles`; since a renderer switch is a **persisted prop
  write** (`mutations.setLensRenderer`), driving all four renderers there would
  have mutated a committed file in someone else's worktree. Same code, isolated
  data, different port was the only safe way to satisfy the brief.
- Every renderer was driven with a real browser (Playwright MCP: real mouse
  moves, wheel, drags, key presses), not simulated events. Claims marked
  **CONFIRMED** below were produced by observing the running app — screenshots,
  canvas pixel readbacks, DOM/computed-style probes, captured page errors — not
  inferred from source. Where a mechanism is proven by reading both sides of a
  seam but not directly executed, it is marked **HIGH**.
- Two evidence passes were run: one at `cfb16a2` (the branch point) and one
  after merging `main` at `d6111c2`, which contains `3b1f82f`
  (`fix(kb-ui): normalize token colors so the 3D graph renders`). Findings are
  tagged with which pass they come from and whether `3b1f82f` fixed them.
- Screenshots live in the session scratchpad (`shots/r10-*.png`) and are cited
  by name; they are deliberately **not** committed.

---

## 1. Q1 — ground truth: what the graph actually does today

### 1.0 The finding that explains the owner's verdict

The owner's live graph was **not** the renderer i2 polished.

`.kb/nodes.jsonl` contains exactly one `#graph-perspective` node,
`lens.all-mentions`, and its persisted props are:

```json
{"sys.f.lens.edge-kinds": [{"t":"str","v":"mention"},{"t":"str","v":"child"}],
 "sys.f.lens.renderer":   [{"t":"str","v":"cluster"}],
 "sys.f.type":            [{"t":"ref","v":"sys.tag.graph-perspective"}]}
```

**CONFIRMED.** `sys.f.lens.renderer = "cluster"`. Opening `/graph` therefore
lands on the **cluster** renderer, and `graph-page.tsx:283-329` mounts
`GraphToolbar` and `GraphLegend` **only in the force2d branch**. So the shipped
default view has:

- no toolbar (no zoom, no fit, no reset, no search),
- no legend and no tag filter,
- no selection-in-place and no info card (click navigates away),
- no hover tooltip,
- no arrows,
- and no visible cluster hulls (§1.3).

Every MUST interaction i2 shipped is invisible from the default entry point.
r2 §4 wrote 18 MUSTs and i2 implemented them **in `sigma-graph.tsx` only**;
nothing in either document required the persisted default renderer to be the
one that carries the chrome. That is the whole gap-of-the-gap: the wave was
graded A− against a renderer the owner never saw.

`sys.f.lens.cluster-by` is **absent**, so `parsePerspective`
(`lib/graph-lens.ts:163`) falls back to `DEFAULT_CLUSTER_BY = "none"`
(`graph-lens.ts:62`) and `resolveClusterKey` returns the literal string
`"none"` for all 126 nodes (`graph-lens.ts:197`). The default perspective
therefore has **exactly one cluster** — which is what breaks both the cluster
renderer and 3D (§1.3, §1.5).

### 1.1 One root cause behind most of the visible damage: camera-space confusion

`graph-camera.ts` mixes two different coordinate spaces. Sigma's camera lives
in **normalized/framed** space — `resetCamera` correctly targets
`{x: 0.5, y: 0.5, ratio: 1}` (`graph-camera.ts:97`), because sigma normalizes
the graph into roughly `[0,1]²`. But `fitView` computes a bounding box from
**raw graph attributes** and then feeds that centroid straight to the camera:

```ts
// graph-camera.ts:53-63, 82-86
graph.forEachNode((_id, attrs) => { const x = Number(attrs.x); ... });
const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
animateCamera(sigma, { x: cx, y: cy, ratio: ... });
```

After FA2 settles, raw coordinates are on the order of ±10²–10³. Setting
camera `x = 300` in a space whose visible extent is `[0,1]` puts the viewport
~300 graph-widths away from the data. `focusNode` (`graph-camera.ts:99-104`)
has the identical defect (`{x: attrs.x, y: attrs.y}`).

Sigma's own API documents the split: `graphToViewport(p)` is defined as
`framedGraphToViewport(this.normalizationFunction(p))`
(`node_modules/sigma/dist/sigma.esm.js:3485-3489`), while
`framedGraphToViewport` (`:3423`) is what takes already-normalized display
coordinates — sigma uses it internally for labels and hovers (`:1949`, `:2209`,
`:2297`).

Observed consequences, all **CONFIRMED** on the running app:

| Trigger | Observed |
|---|---|
| Mount force2d (auto `setTimeout(fitView, 200)`, `sigma-graph.tsx:394`) | canvas **blank**; legend and toolbar render over empty white. `shots/r10-02-force2d.png` |
| Press `0` (reset) | entire 126-node graph appears. `shots/r10-03-force2d-after-reset.png` |
| Press `f` / click **Fit view (f)** | canvas **blank** again. `shots/r10-04-after-f-fit.png` |
| Selection card **Focus (f)** | canvas **blank**; `canvas.sigma-labels` painted-pixel count = **0**. `shots/r10-06-after-focus.png` |
| Search → `Enter` (cycles match focus via `focusNode`) | canvas **blank**; label pixels = **0**. `shots/r10-19-search-enter.png` |
| `+` / `-` zoom | work (they only scale `ratio`) |

So: **the renderer i2 polished renders a blank canvas on load**, and three of
the four camera affordances blank it again on demand. The one that works is the
one that hardcodes normalized coordinates. This is the single highest-value fix
in the whole report — it is a two-line change with an enormous perceived-quality
delta, and it is why "polished" did not survive contact with the owner.

The same space confusion appears twice more:

- **Hover tooltip first-position.** `sigma-graph.tsx:236-240` does
  `sigma.graphToViewport({x: display.x, y: display.y})` on *display* data.
  CONFIRMED: hovering the hub at cursor `(883,334)` placed the tooltip at
  `(456,847)` — 570 px away; a 1-px mouse nudge (which routes through the
  correct `onHoverMove` path) snapped it to `(895,326)`.
- **Cluster hulls.** Same call on display data (`cluster-graph.tsx:206-208`,
  `:299-304`) — see §1.3.

### 1.2 force2d (`sigma-graph.tsx`) — works well once you know to press `0`

Everything below observed after pressing `0` to undo the broken auto-fit.

**Works:** live FA2 worker settle; arrows (`EdgeArrowProgram`); edge width by
`√weight`; hover neighbour highlight; click select-in-place with the info card
(label / degree / Open / Focus); Esc and background click clear; ⌘-click and
double-click open in the outline; `+`/`-`/`0`; search box with substring match;
collapsible legend with per-tag counts and click-to-isolate plus a
"Clear filters" chip; the cap notice and empty/query-error states.

**Broken or unpolished:**

1. Blank on load and on Fit/Focus (§1.1). **Polish-critical.**
2. **Transient-state dim colours are hardcoded and inverted on light theme.**
   `nodeReducer` uses `#444444` for filtered-out nodes and `#666666` for
   search non-matches (`sigma-graph.tsx:105-111`). On the light theme those are
   *darker and larger* than the matches, so filtering by `todo` produces a field
   of dominant dark-grey blobs with a few small orange dots
   (`shots/r10-20-legend-filter-todo.png`), and searching "backend" makes the
   120 non-matches the loudest thing on screen
   (`shots/r10-18-search-backend.png`). The hover path uses
   `rgba(128,128,128,0.15)` instead, which on white is effectively *invisible* —
   non-neighbours vanish rather than ghost (`shots/r10-05-hover-hub.png`).
   Three different dim treatments, none theme-aware, none matching CodeFlow's
   single opacity-based dim. **Polish-critical.**
3. **Filtered/searched sets lose their labels.** Non-matches get `label: ""`
   (correct), but matches are usually small nodes that fall below
   `labelRenderedSizeThreshold: 7`, so isolating a tag yields an unlabeled dot
   field. Isolation should force labels on the surviving set.
4. **Node drag did not move anything.** CONFIRMED: two attempts — a small node
   dragged +120/+60 px and the largest hub dragged −300/+300 px with 15
   intermediate real mouse moves — produced pixel-identical mid-drag and
   post-drop frames (`shots/r10-21-drag-mid.png`, `r10-22-drag-after.png`,
   `r10-23/24/25`). The camera did **not** pan either, which means
   `downNode` fired and `camera.disable()` ran, so the drag was recognised and
   the position write did not take effect. Root cause not isolated (candidates:
   `el.addEventListener("mousemove")` on the container never firing while
   sigma's document-level captor owns the gesture; or the running FA2 worker
   overwriting `x`/`y` on its next tick because the dragged node is not pinned —
   `sigma-graph.tsx:280-283` writes attributes but never sets
   `fixed`/`fx`/`fy`, and CodeFlow's drag works precisely *because* it pins).
   Confidence **CONFIRMED** that drag is a no-op; **HIGH** that the missing pin
   is at least part of it. i11 must treat this as "reimplement drag with
   pinning", not "tweak".
5. Search matches on node **id** as well as label
   (`graph-toolbar.tsx:76-78`), so typing hex/ULID fragments produces
   meaningless hits.
6. Whole-instance rebuild per data batch: the mount effect depends on
   `[nodes, edges, layoutKey, themeKey]` and starts with `sigma.kill()`
   (`sigma-graph.tsx:145-150`) — r2 §1.1 flagged this and i2 did not change it.
7. No settings popover (r2 T4 — cut by i2), so nothing exposes spread / link
   distance / label density / arrow toggles.

### 1.3 cluster (`cluster-graph.tsx`) — hulls are invisible, and the default has one cluster

The whole point of this renderer is the hulls. **They are never visible.** Three
independent defects, each CONFIRMED with numbers:

1. **Coordinate space.** `drawHulls` feeds `getNodeDisplayData()` (framed
   space) into `sigma.graphToViewport()` (`cluster-graph.tsx:206-208`), which
   normalizes a second time. Measured painted extent of the hull canvas:
   a **50×42 px** box at `(545,407)` in a 1220×856 canvas with
   `cluster-by` unset (1427 non-transparent pixels total, alpha 18 = the
   `0.07` fill), and a **209×43 px** box at `(417,384)` with
   `cluster-by=parent` and 15 real clusters (3034 pixels). The hull collapses to
   a speck near the viewport centre regardless of cluster count.
2. **Stacking order.** The hull canvas is `z-0` and the sigma container is
   `z-10` *with an opaque background* — measured
   `sigmaDiv.backgroundColor = "rgb(255,255,255)"`, set imperatively at
   `cluster-graph.tsx:160`. Whatever the hull canvas paints is painted **behind
   an opaque sheet**. Even a correctly-sized hull would be invisible.
3. **Hit-testing.** `hullCanvas.style.pointerEvents = "auto"`
   (`cluster-graph.tsx:293`) but `document.elementFromPoint` over the canvas
   returns `CANVAS.sigma-mouse` every time. Hull click-to-isolate (r2 MUST 13,
   claimed shipped in the i2 handoff) **cannot fire**.

On top of that, `cluster-by` is unset on the only perspective, so all 126 nodes
share the key `"none"`: one attractor, one hull, i.e. the renderer degenerates
into "force2d with no chrome". Setting `cluster-by=parent` produced visibly
grouped structure (`shots/r10-17-cluster-clusterby-parent.png`) — still with
zero hulls, very pale edges, and a right-hand tail of ~40 unlabeled specks
(the >15-cluster overflow that has no "other" bucket rendering).

Also: no toolbar, no legend, no selection card, no hover tooltip, no arrows —
the renderer only has drag (untested for the same reason as §1.2.4) and the
dead hull click.

### 1.4 tree (`tree-graph.tsx`) — legible but unnavigable, and "Fit" is a lie

**CONFIRMED:**

- `Fit` does `setZoom(1); setPan({x:0,y:0})` (`tree-graph.tsx:151-154`) — it is
  a **reset**, not a fit. Clicking it on a **560×2670** SVG inside an
  **1220×856** viewport produced a pixel-identical screenshot
  (`shots/r10-07-tree.png` vs `r10-08-tree-fit.png`); the inner transform stayed
  `translate(-120,902.75)` with no `scale`. Two-thirds of the tree is off-screen
  and no control brings it back.
- Plain wheel does nothing — zoom requires **⌘/Ctrl+wheel**
  (`tree-graph.tsx:126`) — and the container is `overflow-hidden`, so a user who
  does not discover either ⌘+wheel or pointer-drag literally cannot reach the
  rest of the tree.
- Labels collide: `nodeSize([28,160])` with labels drawn at `x=10` and
  truncated at 40 chars, so any label wider than ~150 px overlaps the next
  column ("Migrate TODO.md items into (M5)hat the hell",
  "Revisit app catalog → Nix pack…dHandwritten Nix keeps semantics").
- Nodes whose text is empty render their **ULID** (`d.data.label || d.data.id`,
  `tree-graph.tsx:238`): `01M0QSPHMKFWX7MYSE10V1PQGT` etc. appear as labels.
- Click navigates away — no selection, no hover, no tooltip, no legend, no
  search. Pointer-down starts a pan on *any* target including a node, so
  click-vs-drag is not disambiguated.

### 1.5 force3d (`force3d-graph.tsx`) — the owner's "it doesn't even have 3d"

The 3D pill **is** discoverable (labelled "3D", visible in the header pill
group, `renderer-switch.tsx:4-9`), the lazy chunk **does** load (no network
failures), and the scene container mounts with a live WebGL canvas and
3d-force-graph's own nav hint ("Left-click: rotate, Mouse-wheel/middle-click:
zoom, Right-click: pan"). So this is **not** "i2 never built it" and **not**
"undiscoverable". It is "it renders nothing", and the owner's statement is an
accurate report of experience.

There were **two** independent causes.

**Cause A — colour parsing (already root-caused and fixed on `main`).**
Pass 1 at `cfb16a2`: clicking 3D produced a fully blank white viewport plus two
uncaught page errors,
`polished` error #5, with the stack

```
at vz (force3d-graph-DmGwYYiQ.js)      # polished error thrower
at m.update (force3d-graph-DmGwYYiQ.js) # three-render-objects update
at p / v / _ (kapsule digest)
```

`three-render-objects/dist/three-render-objects.mjs:676-678` does
`parseToRgb(state.backgroundColor)` / `opacify(1, ...)`; `readTokenColor`
returned `oklch(1 0 0)` because Chrome preserves the authored colour space in
computed style (measured: `--background` = `oklch(100% 0 0)`,
`getComputedStyle(probe).color` = `oklch(1 0 0)`); polished supports only
hex/rgb/rgba/hsl/hsla and throws. The throw happened inside kapsule's digest,
which aborted before graph data reached the scene. Proven causal in-session by
overriding the CSS tokens to `rgb(...)` at runtime and remounting: errors went
to zero and geometry appeared. **This is fixed on `main` in `3b1f82f`** with
tests (`tools/kb/ui/src/lib/css-color.test.ts`); recorded here as root-caused,
not re-derived. The same gap silently dropped `readTokenColor`'s `alpha`
option (its regex only matched `rgb()/rgba()`, `css-color.ts` pre-fix), so
edge and hull opacity were wrong in the 2D, tree and cluster renderers too —
which is why edges read as hard dark lines in the pass-1 screenshots.

**Cause B — the cluster force collapses the scene to a point. Not fixed.**
Re-tested after merging `main` (`d6111c2`), with real oklch tokens and **zero
console errors**: 126 nodes / 91 edges render as **one sphere** at the centre
of the viewport (`shots/r10-31-3d-fixed-none.png`). Zooming out shows a single
~2 px speck; zooming in flies the camera through it into empty space
(`shots/r10-12`, `r10-13`).

Root cause, **CONFIRMED**: `force3d-graph.tsx:129-139` installs a custom
`d3Force("cluster", …)` that adds `(attractor − position) × 0.08` to every
node's velocity each tick, with no distance falloff and no per-cluster
separation to fight it. With `cluster-by` unset there is exactly one cluster
key (`"none"`), so `clusters.length === 1` and
`fibonacciSphere(0, 1, radius)` yields **one** attractor — every node is pulled
onto the same point, and 0.08 per tick beats the default charge repulsion.
Setting `cluster-by=parent` (15+ attractors) produced a real point cloud with
links (`shots/r10-15`, `r10-16`) — proving the collapse is attractor
degeneracy, not a data problem.

Everything else 3D lacks, observed:

- **No `zoomToFit`** — even the working `cluster-by=parent` scene occupied a
  ~120 px blob in a 1220×856 viewport on load.
- **No labels.** `nodeLabel("name")` is only 3d-force-graph's hover tooltip,
  and `.float-tooltip-kap` stayed `display: none` at every hover position
  tried. No sprites, so a zoomed-in view is anonymous coloured balls
  (`shots/r10-16`).
- **No selection.** `onNodeClick` goes straight to `onNodeOpen` →
  `navigate("/") + zoomTo(id)`, i.e. clicking a node in 3D **leaves the graph** —
  exactly the interaction r2 called "Critical" for 2D and then left in place
  here.
- **No chrome at all**: no toolbar, no legend, no search, no fit/reset button,
  no autorotate, no way to recover a lost camera (the position cache persists
  the *bad* camera across remounts, `force3d-graph.tsx:141-147`).
- Links are hairlines at the foreground token colour with no width-by-weight,
  no arrows, no curvature, and no directional particles.
- Bundle discipline holds: `three@0.185.1` is pulled only transitively by
  `3d-force-graph@1.80.0` and stays in the lazily-imported
  `force3d-graph-*.js` chunk. There is still **no regression test** asserting
  the sigma/graph-page chunks never import `three` (r2 §3 asked for one; i2
  listed it as follow-up 5).
- One incidental observation worth a line: when the lazy chunk hash changes
  under an open tab, the import 404s, the SPA fallback returns `text/html`, and
  the failure surfaces as a `ViewErrorBoundary` over the whole view rather than
  a retryable "3D failed to load" state.

### 1.6 Cross-cutting

- `renderer` is persisted, transient state is not — correct per r2 MUST 15, and
  the mechanism works (each pill click wrote the prop and the CLI-visible data
  changed). But `set` on a multi-valued prop **appends**: driving it from the
  CLI produced `renderer: ["force2d","force3d"]` and `strProp` silently took
  the first. The UI's `setLensRenderer` evidently unsets first; any other writer
  (agent, extension, CLI) will corrupt the perspective. Worth an assertion.
- No keyboard support outside force2d; `Esc`/`Enter`/`f`/`0`/`+`/`-`/`/` are all
  registered by `sigma-graph.tsx` and `graph-toolbar.tsx`, which only mount for
  force2d.
- `graph-camera.ts` is statically imported by `graph-toolbar.tsx` *and*
  dynamically imported by `sigma-graph.tsx`; the build warns
  `INEFFECTIVE_DYNAMIC_IMPORT`. Cosmetic, but it means the `import()` in the
  Focus handler buys nothing.

### 1.7 Verdict per renderer

| Renderer | Category | One-line |
|---|---|---|
| force2d | **built, then regressed by fitView** | full interaction vocabulary present; blank on load, and 3 of 4 camera verbs blank it |
| cluster | **built, never worked** | hulls mis-projected, painted under an opaque layer, and un-clickable; default perspective has one cluster |
| tree | **built, half-finished** | renders and collapses fine; "Fit" is a reset, no plain-wheel zoom, labels collide, no selection |
| force3d | **built, blocked by a bug, then blocked by a second bug** | colour throw fixed on `main`; still collapses to a single point, and has no fit / labels / selection / chrome |

None of the four is a case of "i2 never built it". Three of four are "built and
broken in a way no test caught", which is the actionable shape: **i11 should
start with a rendering-truth test harness, not with new features.**

---

*(Sections 2–6 follow: Q2 decision table, Q3 porting plan, Q4 3D verdict,
ordered i11 task list, exclusions, sources.)*
