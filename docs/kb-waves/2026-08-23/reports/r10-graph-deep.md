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

---

## 2. Q2 — which CodeFlow subsystem to copy, for what, and which to reject

CodeFlow is `/tmp/codeflow-study/index.html` at `4f0d944`, 10838 lines. All line
numbers below are from that file and were re-read for this report.

One framing point first. r2 §1.2 listed six things to "copy wholesale" and i2
implemented five of them, yet the result did not read as polished. The reason is
visible in the table: **the value in CodeFlow is concentrated in its
*treatments*, not its *features*.** kb has selection; CodeFlow has selection
that fades 200 ms into a 0.2-opacity ghost field. kb has a fit button;
CodeFlow's is computed in screen space and clamped. Copying the feature list
again would produce the same grade. The rows below are therefore weighted toward
treatments and invariants, and several "kb already has this" features are marked
**Adapt** precisely because the mechanism is present and the treatment is not.

| # | CodeFlow subsystem | Verdict | What kb gets | Cost | Why |
|---|---|---|---|---|---|
| 1 | **Opacity-based selection dim** — `updateGraphHighlight` (7737-7748): 200 ms `d3` transition; selected `opacity 1` + `#ff5f5f`, affected `1` + `#ff9f43`, everything else `opacity 0.2` keeping its own colour; incident links `stroke-opacity 0.8`, others `0.05`, none `0.4` | **Copy wholesale** | Replaces kb's three inconsistent, theme-blind dim treatments (`#444444` filter, `#666666` search, `rgba(128,128,128,0.15)` hover — §1.2.2) with one rule that works in both themes and keeps colour identity while dimming | Low. Sigma reducers already return per-node data; the change is "compute `color` with an alpha multiplier instead of substituting grey", plus a short tween | This is the single biggest perceived-quality delta available. Colour substitution destroys the information the colour encoded *and* inverts contrast on light themes; alpha does neither. It is also the only dim treatment that composes — search ∩ filter ∩ hover can multiply alphas instead of fighting over one `color` slot |
| 2 | **Screen-space fit transform** — `computeGraphFitTransform` (8998-9009): bbox of live sim nodes → `scale = 0.8 / max(dx+pad/w, dy+pad/h)` → `zoomIdentity.translate(w/2 - scale·cx, h/2 - scale·cy).scale(min(scale, 2))`; `fitView` applies it over 400 ms (9010-9018) | **Copy wholesale** | A `fitView` that works. Note the two details kb's version lacks: the transform is built in **screen space**, and the scale is **capped at 2** so a 3-node lens does not zoom to absurdity | Low — it is a rewrite of one 40-line function | kb's `fitView` feeds raw graph coordinates to a normalized-space camera and blanks the canvas (§1.1). The porting note matters: sigma has no `zoomIdentity`, so the equivalent is `camera.setState({x, y, ratio})` with the centre in *normalized* space and scale expressed via `ratio`. Never pass a graph coordinate to `camera.setState`. **Correction (orchestrator, post-i11):** the `currentRatio / scale` form originally written here is wrong for sigma. CodeFlow can divide by `scale` because it rebuilds its transform from `zoomIdentity` on every fit, so its base is genuinely identity. Sigma's `ratio` is already absolute — the visible framed extent — and framed coordinates are camera-independent, so `scale` is constant and dividing the live ratio by it again on each fit walks the zoom inward (0.75 → 0.5625 → 0.42 …). The absolute form is `ratio = max(span / 0.8, 0.5)`, where the 0.5 floor *is* the 2× zoom-in cap; it satisfies the same acceptance numbers and is idempotent. Fixed in `graph-camera.ts` with an idempotence regression test |
| 3 | **Drag with `fx`/`fy` pin + `alphaTarget` reheat** — `node.call(d3.drag()...)` (8055): `start` → `alphaTarget(0.1).restart()`, `d.fx = d.x`; `drag` → `d.fx = e.x`; `end` → `alphaTarget(0)`, `d.fx = null` | **Copy wholesale (as a rewrite)** | Working drag. kb's drag is a **no-op** today (§1.2.4) | Medium. The graphology mechanism is different but present: `graphology-layout-forceatlas2` honours a **`fixed: true`** node attribute in both the sync and worker paths (`iterate.js:21,698,744`; `webworker.js:33,710,756`) — it skips position writes for fixed nodes | The pin is not a nicety, it is what makes drag *possible* while a layout is running: without it the worker overwrites the dragged position on its next tick. kb writes `x`/`y` and never sets `fixed`, which is very likely why nothing moved |
| 4 | **Hulls in the same paint tree, drawn under links, labelled above the cluster** — `hullLayer` appended before `linkLayer`/`nodeLayer` (7984-7986); `updateHulls` (8066-8082): 4 padded corner points per node (`pad = 30`) → `d3.polygonHull` → `fill-opacity 0.04`, `stroke-opacity 0.25`, `stroke-width 2`; label at `mean(x)`, `min(y) − pad − 8` | **Copy wholesale** | Visible hulls. Three specific corrections to kb's version: (a) same stacking context, no opaque layer on top; (b) hull built from **padded corner points**, which avoids degenerate slivers for 2–3-node clusters without kb's special-case arc branch; (c) label **above** the cluster, not at the centroid where it collides with nodes | Medium — kb's hull canvas needs to move above the sigma container (or become a sigma layer) and stop being covered by an opaque background | kb's hulls are invisible for three independent reasons (§1.3) and its centroid label would collide even if they weren't. The padded-corner trick is the non-obvious part worth stealing verbatim |
| 5 | **Radius-derived label truncation and density** — labels drawn only if `!isLargeGraph \|\| showLabels` (8061); font size `max(6, min(10, r·0.6))`; **truncation length from radius**: `maxLen = max(4, floor(r/2))` (8062) | **Copy wholesale** | Labels that stop overlapping. Big hubs get long labels, leaf dots get 4 characters or none | Low, but it must move **out of the extract**: kb truncates to a flat 40 chars in `graph-lens.ts`, which is a data-layer decision about a render-layer concern | A flat 40-char label on a size-3 node is the direct cause of the label collisions in `shots/r10-03` and the tree's overlap (§1.4). Deriving length from rendered size is the whole trick, and it is 3 lines |
| 6 | **Counter-scaled labels on zoom** — `readableLabelScale(k)` applied to `text.node-label` and hull labels on every zoom event (7970-7976, 7977-7981) | **Adapt** | Labels stay legible when zoomed out instead of vanishing below `labelRenderedSizeThreshold` | Low-medium | Sigma does not scale label text with the camera, so the *problem* is different: kb's failure mode is labels disappearing, not shrinking. Adapt to "raise label density and lower the size threshold as `ratio` grows", driven off the camera `updated` event. Do not port the transform literally |
| 7 | **Settings popover with live-applied controls** — toolbar `⚙` toggle (9989-9991) opening a panel with Layout sub-mode buttons, `Spread` 50–500, `Links` 30–200, `Show labels`, `Curved links`, `Auto-rotate` (9993-10025) | **Adapt** | The r2 T4 item i2 cut. This is the discoverability surface for everything in rows 5, 6, 8, 12 | Low-medium | Adapt the *contents*, not the storage. CodeFlow keeps all of it in one ephemeral `graphConfig` React object (6488). In kb these are perspective properties (`sys.f.lens.*`) so they survive reload, are queryable, and are settable by an agent through the CLI — kb's rule that UI actions are reachable through data. Split explicitly: layout/spread/link-distance/labels/curvature/autorotate **persist**; the popover's open/closed state does not |
| 8 | **Layout sub-modes** — five modes, each a different composition of d3 forces over per-node `targetX`/`targetY` anchors: `force` (folder-centre springs at 0.15), `radial` (ring anchors at 0.8), `hierarchical` (layer columns, x at 0.9 / y at 0.3), `grid` (cell anchors at 1.0), `metro` (BFS lines at 0.95) — 7989-8046 | **Adapt (and cut `metro`)** | `radial`, `hierarchical`, `grid` are genuinely useful lenses over a knowledge graph and each is ~15 lines of arithmetic | Medium | The important porting fact: **these are not five layout engines, they are one engine plus anchor springs**, and FA2 has no anchor force. So in kb they become *pure position functions* that assign `x`/`y` directly and skip FA2 entirely; only `force` runs the worker. That is simpler than CodeFlow, not harder. `metro` is rejected: it is a BFS-over-dependency-direction device that assumes a code-import DAG, and on a `mentions` graph it degenerates (every node with no inbound mention becomes a "line root") |
| 9 | **Adaptive params by graph size** — `isLargeGraph = nodes.length > 300` → `alphaDecay 0.08 / velocityDecay 0.7`, hull update every 5th tick instead of every tick, labels off (8047-8051, 8084-8086) | **Adapt** | A second, lower degradation tier | Low | kb already has one tier at 1500 nodes (`LARGE_GRAPH_THRESHOLD`, `sigma-graph.tsx:35`) tuned for hiding edges on move. CodeFlow's threshold is 5× lower because SVG is 5× more expensive than WebGL — do not copy the number. Copy the *shape*: throttle hull redraw by tick count (kb redraws hulls on every `afterRender`, `cluster-graph.tsx:288`) and step label density down before edges |
| 10 | **In-canvas error state** — the whole force-graph body is wrapped in `try/catch` that clears the SVG and draws `'Graph rendering error: ' + e.message` into it (8098) | **Copy wholesale** | Every kb graph failure today is either a silent blank canvas or a whole-view `ViewErrorBoundary` (§1.5). A renderer that fails should say so *in the canvas frame* and leave the rest of the page alive | Low | This is the cheapest defence against exactly the class of bug this report is made of: three of four renderers failed silently, and a `console.warn`-only path (`graph-lens.ts` `resolveNodeSet`) was already called out in r2 §1.1 and still exists |
| 11 | **3D scene configuration** — `linkWidth` `max(0.8,min(3,√count·0.4))` ×2 when incident to selection, ×0.3 otherwise (8239-8248); `linkDirectionalArrowLength` 3.5 / 5.0 / 0 (8249-8259); `linkDirectionalParticles` 1 → **4 on selected-incident** → 0 (8261-8290); `linkCurvature 0.25` (8291); `linkColor` selection-aware with non-incident at **0.08 alpha** (8228-8238); `nodeResolution(24)`; `showNavInfo(false)` (8216-8218); sprite labels via `CanvasTexture` + `nodeThreeObject` (8306-8377); `controls().autoRotate` + `autoRotateSpeed 1.0` (8380-8389) | **Copy wholesale** | Effectively all of kb's 3D specification (§4). Every one of these is a one-line `3d-force-graph` call and together they are the difference between "coloured balls" and a scene | Low individually; the sprite labels are the only non-trivial piece | Note `showNavInfo(false)`: kb leaves the default hint on, and in the broken state that hint was **the only thing visible** in the viewport. Also note CodeFlow passes `'#ffffff'` / `'#0a0a0c'` as **literal hex** to `backgroundColor` (8215) — which is exactly why CodeFlow never hit the polished/oklch throw that blanked kb's 3D |
| 12 | **3D click = animated fly-to + select in place** — `onNodeClick` (8292-8302): computes a point 120 units out along the node's own vector and calls `cameraPosition(newPos, node, 1200)` so the camera eases in *and* looks at the node, then selects it; `onBackgroundClick` clears (8301-8304) | **Copy wholesale** | The best interaction CodeFlow has, and the one kb's 3D most conspicuously lacks: kb's `onNodeClick` **leaves the graph** (`graph-page.tsx:272`, `onNodeOpen` → `navigate("/")`) | Low | r2 called click-to-navigate "Critical" for 2D and then left it in 3D. A 3D scene where clicking a node exits the 3D scene cannot be explored |
| 13 | **3D cluster force** — `customForce(axis, targetSelector, strength)` (8420-8432) applying `node[v] += (target − node[p]) · strength · alpha` on x/y/z separately at strength 0.15, registered under the canonical `d3Force('x'/'y'/'z')` names, Fibonacci-sphere centres at radius 180 (8404-8418), and **explicitly nulled out when there are no groups** (8442-8445) | **Copy wholesale** | The fix for the collapse in §1.5. Two differences from kb's version are each independently causal: CodeFlow multiplies by **`alpha`** so the pull cools as the sim settles, and CodeFlow **clears the force when `groups.length === 0`** | Low — it is a 12-line function | kb's force (`force3d-graph.tsx:129-139`) ignores the `alpha` argument and applies a constant 0.08 forever, so it never yields to charge repulsion; and with `cluster-by` unset there is one attractor, so all 126 nodes are pulled onto one point. Both defects are visible in `shots/r10-31` |
| 14 | **Node identity preserved across data updates** — `existingNodesMap` reuses the previous node objects so positions *and velocities* survive a re-render (8112-8134); teardown is `pauseAnimation()` + empty `graphData`, keeping the instance (8461-8464) | **Adapt** | No sim reset on every WS tick | Medium | kb rebuilds objects and restores only `x/y/z` from a `Map` (`force3d-graph.tsx:88-105`), losing velocity, and calls `_destructor()` on every effect run. The same disease exists in 2D (`sigma.kill()` per data batch, flagged in r2 §1.1 and still unfixed). Adapt as one shared principle — *diff, don't rebuild* — rather than two copies |
| 15 | **Info chips** — `<n> files`, `<n> links`, `<n> custom excludes`, and when something is selected `<n> dependents • <n> fns used` (10026-10042) | **Adapt** | kb's header has a bare `126 nodes · 91 edges`. The chip worth stealing is the **selection-relative** one: "N dependents" tells you why the highlight looks the way it does | Low | Adapt to kb's vocabulary: `N backlinks · M mentions · depth-1 neighbourhood K`. Keep them in the floating canvas layer, not the h-11 header, which r2 §5.1 already found overloaded and which has since gained an ontology picker |
| 16 | **Legend-as-data-filter** — `legend-item` click → `filterByFolder(f)` → `folderFilter` state → **every renderer re-derives `filteredFiles` and re-runs layout** (10043-10054, and the `folderFilter` reads at 7945, 8110, 8481, 8551, 8610) | **Reject the mechanism, keep the affordance** | Nothing — kb's version is better | — | kb already has a collapsible legend with counts and click-to-isolate implemented as a **sigma reducer** (`graph-legend.tsx`, `sigma-graph.tsx:100-112`), so the layout does not move when you filter. CodeFlow's data-set filter re-runs the whole simulation, so every legend click throws the layout away and re-settles — jarring, and the reason its filter feels like a page change. Keep kb's reducer approach; take only the missing polish (force labels on the surviving set, row 3 of §1.2) |
| 17 | Ephemeral `graphConfig` / `colorMode` / `viewMode` React state (6488) | **Reject** | Nothing | — | This is the axis where kb is structurally ahead and must not regress. kb's perspectives are persisted, queryable `#graph-perspective` sys-nodes; CodeFlow's view state dies with the tab. Every control the settings popover (row 7) grows must land as a `sys.f.lens.*` prop, with only genuinely transient state (search text, hover, transient tag isolation, popover open) left in React |
| 18 | Hardcoded folder-based clustering and `LAYER_COLORS` layer taxonomy (7955-7969, 8004-8014) | **Reject** | Nothing | — | kb's `cluster-by` is already configurable across `tag:` / `prop:` / `parent` / `none` (`graph-lens.ts:189-217`), which is strictly more general than "folder". The *bug* is that the default is `"none"` and nothing surfaces the choice (§1.0) — that is a defaults-and-UI problem, not a reason to copy a hardcoded taxonomy. Same for `hierarchical`'s `layerOrder` map: port the column mechanism, source the order from a kb ontology or tag order |
| 19 | Blast-radius *semantics* — `calcBlast(path, connections, files)` computing `affected` (transitive dependents) and `dependencies` (7722), rendered as size ×1.4 and distinct purple/orange fills (8189-8201) | **Reject as-is, adapt the visual** | The two-tone treatment (self / affected / rest), not the graph theory | Low | "Transitive dependents of a source file" has no kb analogue worth faking; kb's honest equivalent is the depth-1 (and optionally depth-2) `:node/mentions` neighbourhood it already computes for hover. Take the visual grammar — self, ring 1, ring 2, rest — and drop the dependency-direction semantics |
| 20 | `exportSVG` with inlined theme variables (9019-9027) | **Reject (defer)** | — | — | Genuinely nice, genuinely out of scope for a polish wave, and only meaningful for the SVG-based tree renderer since sigma and three are canvas/WebGL. Noted so the next reader does not have to rediscover it |

### 2.1 Where this contradicts r2

- r2 §1.1 rated force3d's gap **"low-medium"** and §4 concluded 3D is
  "exploratory, not primary navigation … do not invest beyond parity". Both are
  withdrawn. The gap was not low-medium; the renderer produced an empty
  viewport (§1.5). r2 could not have known — it read the source, and the source
  looks complete. The lesson for i11 is the one r2 missed: **a renderer with no
  rendering assertion in its test suite has no evidence behind its grade.**
- r2 §1.2.1 said to copy "blast-radius-style neighborhood coloring". Row 1
  refines this: copy the **opacity** treatment, not the colouring. i2 copied the
  colouring (`#444444`/`#666666`) and that is exactly what looks wrong on the
  light theme.
- r2 §1.1 called the frozen one-shot layout "the single biggest 'feel' gap".
  That was true then and i2 fixed it with the FA2 worker. It is no longer the
  biggest gap; the camera is (§1.1).
- r2 §7 T4 (settings popover) was ranked below T5-T9 in the cut order and duly
  cut. Row 7 promotes it, because it is the only surface that makes `cluster-by`,
  layout mode and label density discoverable — and `cluster-by` being invisible
  is half of why the cluster renderer and 3D both degenerate (§1.0).

---

## 3. Q3 — how to pull it in properly

### 3.1 What does not move

The data plane is invariant, exactly as the graphviz report §4 locked it:
`/api/graph` + `/ws` stay the only shared surface, every renderer stays a pure
client of `extractLensGraph`, and every viz remains
"datalog query → `{nodes, edges}` → renderer". Nothing in Q2 requires a server
change. Nothing in Q2 requires a new query.

### 3.2 The one structural change: chrome must stop being force2d-only

This is the finding from §1.0 and it dictates the shape of the port.
`graph-page.tsx` currently mounts `GraphToolbar` and `GraphLegend` inside the
force2d branch (`:283-329`), so every renderer that is not force2d is naked.
The port must invert that:

- Extract a **`GraphCanvasFrame`** that owns the floating toolbar, the legend,
  the info chips, the cap notice, the empty/error states and the keyboard map,
  and renders `children` — the active renderer — inside it. `graph-page.tsx`
  becomes `frame(renderer)`, not `if (force2d) frame else bare`.
- Give the frame a small **renderer capability descriptor** so a renderer can
  declare what the shared chrome may drive: `{ fit, zoom, reset, focus, search,
  selection, dim, drag }`. Tree has no `zoom` in the camera sense but does have
  `fit`; 3D has `fit`/`zoom`/`focus`/`selection` but no sigma reducer. The
  toolbar renders the intersection and greys the rest, instead of the frame
  assuming a `Sigma` instance — which is what `GraphToolbar`'s
  `sigmaRef: MutableRefObject<Sigma | null>` prop hardcodes today.
- Consequence: the keyboard map (`Esc`/`Enter`/`f`/`0`/`+`/`-`//`) moves to the
  frame and works in all four renderers instead of one.

### 3.3 Where each Q2 row lands

| Q2 row | Lands in | Portability |
|---|---|---|
| 1 opacity dim | new `lib/graph-dim.ts` (pure: `(state) => alphaFor(nodeId)`), consumed by `sigma-graph.tsx` + `cluster-graph.tsx` reducers and by `force3d-graph.tsx`'s `nodeColor`/`linkColor` accessors | **Portable logic.** The alpha-composition rule is pure and unit-testable; only the application differs per renderer |
| 2 fit transform | rewrite `components/graph/graph-camera.ts` | **Must be rewritten against sigma.** d3's `zoomIdentity` has no sigma equivalent; the correct target is `{x: 0.5, y: 0.5, ratio: currentRatio / scale}` in normalized space. Add a same-named `fitView3d` that just calls `zoomToFit(600)` |
| 3 drag + pin | `sigma-graph.tsx`, `cluster-graph.tsx`; pin flag written as the graphology node attribute `fixed` | **Mechanism differs, concept identical.** `fx/fy` → `fixed: true`. Also fix the gesture plumbing: bind the move/up listeners on `document` (as sigma's own captor does, `sigma.esm.js:487-490`) rather than on the container |
| 4 hulls | `cluster-graph.tsx`; hull canvas moves above the sigma container and the imperative opaque `el.style.background` (`:160`) goes away | **Portable logic** (padded corner points, `convexHull` already exists in `lib/convex-hull.ts`) + **a fix that is not a port**: the projection must use `sigma.framedGraphToViewport(displayData)`, never `graphToViewport(displayData)` |
| 5 label truncation | `lib/graph-label.ts` (new, pure) called from the renderers; the flat 40-char truncation leaves `lib/graph-lens.ts` and `LensNode` keeps the **full** text | **Portable logic.** Note this reverses part of i2's T2: truncation is a render decision and the extract should stop making it |
| 6 zoom-aware density | `sigma-graph.tsx` on the camera `updated` event | **Rewrite** — different failure mode, different fix (§2 row 6) |
| 7 settings popover | new `components/graph/graph-settings.tsx` inside the frame; writes via `actions/mutations.ts` (`setLensRenderer`'s siblings) | **UI port; storage inverted.** Each control is a `sys.f.lens.*` prop write. `mutations` needs a generic `setLensProp(perspectiveId, field, value)` that **unsets before setting** — props are multi-valued and `set` appends (§1.6) |
| 8 layout sub-modes | new `lib/graph-layouts.ts` (pure `(nodes, edges, size) => Map<id, {x,y}>`), selected by a new `sys.f.lens.layout` prop; `force` alone delegates to `fa2-layout.ts` | **Rewrite, and simpler than the original.** FA2 has no anchor springs, so the anchored modes assign positions directly and never start the worker. This also makes them instant and deterministic — unit-testable, which the d3 versions are not |
| 9 adaptive tiers | `sigma-graph.tsx` (existing threshold), `cluster-graph.tsx` (hull tick throttle) | Portable shape, not the numbers (§2 row 9) |
| 10 in-canvas error | the frame, plus a real error surface for `resolveNodeSet`'s currently `console.warn`-only failure (`lib/graph-lens.ts`) | **Portable** |
| 11-14 3D | `force3d-graph.tsx` | **Portable** — every item is a `3d-force-graph` builder call already available in `1.80.0`. The sprite labels are the only part that touches `three` directly, and `three` is already in that chunk |
| 15 info chips | the frame | Portable |
| 16 legend | keep `graph-legend.tsx`; move it into the frame so all renderers get it | — |

### 3.4 Persisted vs transient — the explicit split

kb's rule is that a UI action should be reachable through data. Applying it:

**Persisted** as `sys.f.lens.*` props on the `#graph-perspective` node (and
therefore CLI- and agent-settable, and surviving reload):
`renderer` (exists), `cluster-by` (exists, unset), `color-by`, `size-by`,
`edge-kinds`, `max-nodes`, `focus` (all exist), plus new:
`layout` (`force|radial|hierarchical|grid`), `spread`, `link-distance`,
`show-labels`, `curved-links`, `autorotate`, `label-density`.

**Transient** React state, never written: search text and match set, hover,
transient tag/cluster isolation, selection, popover open/closed, camera. This is
r2 MUST 15 and it held up in testing — do not weaken it. The one addition:
because `cluster-by` is invisible today, the settings popover **must** surface
it; a persisted prop nobody can see is how §1.0 happened.

**Also fix while here:** `mutations.setLensRenderer`-style writers must unset
before set. Driving `sys.f.lens.renderer` from the CLI produced
`["force2d","force3d"]` and `strProp` silently took the first (§1.6). Any
agent, extension or CLI writer will corrupt a perspective this way.

### 3.5 Bundle discipline

- `three@0.185.1` arrives only transitively via `3d-force-graph@1.80.0` and must
  stay inside the lazily-imported `force3d-graph-*` chunk. Verified by
  inspection this session; still **not** covered by a test. r2 §3 asked for the
  assertion, i2 listed it as follow-up 5 — i11 must land it, because every 3D
  item in Q2 row 11 adds imports to that file.
- No new heavy dependency is needed for anything in Q2. Rows 1-10 and 15-16 are
  arithmetic over packages already installed; rows 11-14 are configuration of a
  package already installed. The three packages i2 added
  (`graphology-layout`, `graphology-layout-noverlap`,
  `graphology-communities-louvain`) cover the remaining layout needs; row 8's
  anchored modes need none of them.
- `graph-camera.ts` is currently both statically imported (`graph-toolbar.tsx`)
  and dynamically imported (`sigma-graph.tsx`'s Focus handler), which the build
  reports as `INEFFECTIVE_DYNAMIC_IMPORT`. Make it static everywhere.

### 3.6 What cannot be ported cleanly

1. **d3's transition system.** Rows 1 and 12's *feel* comes from `d3`
   transitions on SVG attributes. Sigma has no attribute tweening — reducers are
   sampled per frame. So the port is an explicit animation clock: a
   `useDimTransition` hook that advances a 0→1 progress value over ~200 ms and
   drives the alpha the reducers read, calling `sigma.refresh()` per frame while
   in flight. Build this once, in the frame, rather than per renderer.
2. **`readableLabelScale` counter-scaling** — no sigma equivalent (§2 row 6).
3. **`metro` layout** — rejected on data-model grounds (§2 row 8).
4. **`exportSVG`** — only meaningful for the tree renderer; deferred.
5. **CodeFlow's single-file structure itself.** Its 10 838-line `index.html`
   keeps every renderer in one closure, which is why `selected`, `blastRadius`,
   `folderFilter` and `graphConfig` can be read directly by all of them. kb's
   equivalent of that shared closure is the frame (§3.2) plus the perspective
   node — and unlike CodeFlow's, kb's survives a reload.

---

## 4. Q4 — 3D: what it should be

### 4.1 Verdict: first-class navigation mode, and r2's verdict is withdrawn

r2 §4 concluded "3D is exploratory, not primary navigation; polish it cheaply,
do not invest beyond parity". I contradict that, for three reasons that r2 did
not have:

1. **The evidence r2 reasoned from was wrong.** r2 rated the force3d gap
   "low-medium" from source inspection. Running it showed an empty viewport
   (§1.5). "Exploratory" is a defensible priority call about a working feature;
   it is not a defensible one about a feature that renders nothing.
2. **The owner's signal is the product signal we have.** "It doesn't even have
   3d" is not a request for a novelty; it is a report that a labelled affordance
   in the header did nothing. Whatever the priority, a pill that renders an empty
   scene must not ship.
3. **The cost curve is inverted from what r2 assumed.** Almost everything 3D
   needs is a one-line `3d-force-graph` builder call (§2 row 11). The expensive
   parts of a graph UI — the query layer, the perspective model, the extract, the
   dim rule, the settings popover — are shared with 2D and are being built
   anyway. 3D's *marginal* cost is small; r2 priced it as if it were a separate
   product.

So: **3D is a first-class renderer**, held to the same interaction contract as
force2d, with two honest exceptions — no rubber-band selection and no node drag
(orbit controls own the drag gesture; pinning in 3D is a genuinely different
interaction and is out of scope).

What it is *not*: the default. The persisted default renderer should be
**force2d** (see task 3 below), because a 2D hairball is legible on first
contact and a 3D cloud needs camera skill. 3D is one pill click away and, once
clicked, is persisted per perspective — which is the right shape: the *user*
decides it is their primary view, and the graph remembers.

### 4.2 Vehicle: keep `3d-force-graph@1.80.0`

Decision on the four axes the brief names:

- **Quality.** Everything in the §4.3 spec is already a first-class option in
  1.80: `zoomToFit`, `cameraPosition(pos, lookAt, ms)`,
  `linkDirectionalParticles`, `linkDirectionalArrowLength`, `linkCurvature`,
  `linkWidth`, `nodeThreeObject`, `controls().autoRotate`, `nodeResolution`,
  `d3Force`. CodeFlow's entire 3D scene is ~200 lines of configuration against
  this same library (8205-8445). Hand-rolling against three.js would mean
  reimplementing a 3D force simulation, GPU picking for hover/click, the
  particle system, and camera easing — for the same result.
- **Bundle size.** The built `force3d-graph-*` chunk is **1 374 842 bytes**
  uncompressed, against 225 202 for `graph-page-*`. That is large, but
  `three@0.185.1` is the dominant term and **both** candidate vehicles pay it —
  react-three-fiber is a renderer binding, not a replacement for three. Swapping
  would trade a ~200 KB wrapper for hand-written equivalents of the same
  functionality. The invariant that matters is the one kb already has: the chunk
  is lazily imported and must never join `graph-page`. Keep it, and finally
  assert it (task 16).
- **Maintenance.** `3d-force-graph@1.80.0`, `three-render-objects@1.42.0`,
  `kapsule@1.16.3` are all Vasco Asturiano's, actively released, and the same
  stack CodeFlow ships. One caveat learned the hard way this session: the
  colour path goes through `polished@4.3.1`
  (`three-render-objects.mjs:676-678`), which supports only
  hex/rgb/rgba/hsl/hsla. kb must hand it a parsed colour, never a raw CSS
  token — which is what `3b1f82f` now guarantees. Encode that as a rule, not a
  memory: **every colour crossing into the 3D renderer MUST be normalized
  rgb/rgba** (task 16's test).
- **License.** MIT throughout: `3d-force-graph` 1.80.0, `three` 0.185.1,
  `three-render-objects` 1.42.0, `kapsule` 1.16.3, `polished` 4.3.1. No change
  to the repo's MIT-family standard. (react-three-fiber is also MIT; license is
  not the deciding axis.)

**Rejected:** driving three.js / react-three-fiber directly. Revisit only if a
3D lens needs geometry that `nodeThreeObject` cannot express — and note that
`nodeThreeObject` already hands you a raw `THREE.Group`, which is the escape
hatch CodeFlow uses for its sprite labels (8309-8375). We are not blocked.

### 4.3 Specification — what "has 3D" must mean

Numbered MUSTs; these are normative for i11 and each is demoable.

**Scene legibility**

1. MUST `zoomToFit(600, padding)` once the layout has settled on first mount,
   and MUST expose it as an explicit control. A scene that loads as a speck in
   the middle of a 1220×856 viewport (`shots/r10-31`) reads as "broken", which
   is precisely how the owner read it.
2. MUST NOT collapse. The cluster force MUST scale by the simulation `alpha`
   argument it is given, and MUST be removed entirely (`d3Force('x', null)`)
   when the perspective yields fewer than two distinct cluster keys. Acceptance:
   with `cluster-by` unset, the bounding box of node positions after settle is a
   non-degenerate volume, not a point.
3. MUST hide the library's own nav hint (`showNavInfo(false)`) and provide kb's
   own controls hint in the frame instead. Today that hint is the only content
   in the viewport when the scene fails.
4. MUST render labels in-scene for the top-N nodes by size, as canvas-texture
   sprites (`nodeThreeObject` + `nodeThreeObjectExtend(false)`), with the same
   radius-derived truncation as 2D (§2 row 5). A zoomed-in view of anonymous
   coloured balls (`shots/r10-16`) is not navigation. Sprites for *every* node
   at 126+ nodes is a texture-memory decision, hence top-N with the count
   driven by the same adaptive tier as 2D label density.
5. MUST give links visible weight and direction: width
   `max(0.8, min(3, √weight · 0.4))`, `linkDirectionalArrowLength(3.5)` with
   `linkDirectionalArrowRelPos(1)`, and `linkCurvature` 0.25 behind the persisted
   `curved-links` prop. kb's current hairlines carry neither weight nor
   direction, so a directed `mentions` graph reads as undirected — the same
   information loss r2 §1.1 called out for 2D and i2 fixed only in 2D.

**Interaction parity with 2D**

6. MUST select in place on click, never navigate. Click MUST (a) set the shared
   selection state the frame owns, (b) animate the camera to the node via
   `cameraPosition(offsetAlongNodeVector, node, 1200)` so the node is both
   approached and looked at, and (c) show the same selection card as 2D with the
   same **Open** affordance for leaving to the outline. Background click and
   `Esc` MUST clear. This is a direct port of CodeFlow 8292-8304 and it is the
   single change that turns kb's 3D from a picture into a view.
7. MUST express selection through the shared dim rule (§2 row 1): the selected
   node full strength, its depth-1 neighbourhood full strength, everything else
   at low alpha — via `nodeColor`/`linkColor` accessors, since 3D has no sigma
   reducer. Incident links MUST get `linkDirectionalParticles(4)` at
   `ParticleSpeed(0.015)` / `ParticleWidth(2.5)` while selected, and 1 / 0.004 /
   1.2 at rest (CodeFlow 8261-8290). The particles are the one purely decorative
   item I would defend at 3am: they are how a 3D scene communicates edge
   direction, which arrows alone do not at oblique angles.
8. MUST show a hover card with the same fields as 2D (label, tags, degree).
   `nodeLabel()` already provides the mechanism and accepts HTML
   (CodeFlow 8220-8227); it just has to be given kb's content instead of a bare
   name.
9. MUST participate in the shared chrome (§3.2): toolbar fit/zoom-in/zoom-out
   (`cameraPosition` scaled ×0.7 / ×1.4 over 400 ms, CodeFlow 8966-8989),
   legend, info chips, and the `f` / `0` / `+` / `-` / `Esc` keys. Today 3D has
   no chrome at all and a lost camera is unrecoverable.
10. MUST offer `autorotate` as a persisted `sys.f.lens.autorotate` prop applied
    through `controls().autoRotate` with `autoRotateSpeed 1.0`, default off.
11. MUST NOT persist a camera it cannot recover from. The position/camera cache
    (`force3d-graph.tsx:141-147`) currently restores a bad camera across
    remounts; it MUST be invalidated whenever the node set changes materially,
    and `0` MUST always return to `zoomToFit`.

**Discovery**

12. MUST be discoverable without pixel archaeology. The pill is already there
    and labelled "3D" — that part was never the problem. What MUST change is
    that switching to it produces something obviously alive within one second:
    fitted, labelled, orbitable. Failing that, it MUST show the in-canvas error
    state (§2 row 10), never a white rectangle.

**Explicitly out of scope for 3D:** node drag/pinning (orbit owns the gesture),
multi-select, and hulls/cluster shells in 3D (transparent geometry at this scale
is a research project, not a polish item).

---

## 5. Ordered i11 task list

Each task is independently shippable and lands on the one before it. **PC** =
polish-critical (closes the owner's "not polished enough"); **A** = additive
capability. Zones are the file sets a task may touch; `lib/graph-lens.ts` and
`graph-page.tsx` are shared-file touches to be declared in the handoff.

| # | Task | Kind | Acceptance test | Zone |
|---|---|---|---|---|
| 1 | **Rendering-truth harness.** For each of the four renderers, mount with a fixed 30-node fixture, let layout settle, and assert the renderer actually *painted*: sigma — ≥90% of node display positions inside viewport bounds and `canvas.sigma-labels` painted-pixel count > 0; tree — SVG node count equals fixture size and the content bbox intersects the viewport; force3d — `graphData().nodes.length` equals fixture size and the position bounding box is non-degenerate. | **PC** | The four assertions above. Each must **fail** against today's `HEAD` for force2d (blank after auto-fit), cluster (hull pixels ≈ 0 outside a 50 px box) and force3d (degenerate bbox) — a harness that passes on a broken build is worthless. | new `components/graph/*.render.test.tsx`, `components/graph/__fixtures__/` |
| 2 | **Fix camera space.** Rewrite `fitView`/`focusNode` to set camera `{x, y}` in normalized space and scale via `ratio` (target = `currentRatio / scale`), with CodeFlow's `0.8` padding factor and `min(scale, 2)` cap. Make `graph-camera.ts` a static import everywhere. | **PC** | After `fitView` on the fixture, every node's viewport position is inside the canvas and camera `x`,`y` ∈ [0,1]; task 1's force2d assertion passes. `INEFFECTIVE_DYNAMIC_IMPORT` gone from the build log. | `components/graph/graph-camera.ts`, `graph-toolbar.tsx`, `sigma-graph.tsx` |
| 3 | **Kill the mount-time fit race and set a sane default renderer.** Fit after the layout reports settled, not on a 200 ms timer; and change the seeded `lens.all-mentions` perspective's `sys.f.lens.renderer` to `force2d` with a one-time data migration. | **PC** | Mount → settle → nodes visible without any key press (task 1's assertion, with no `resetCamera` in the test). `kb query` shows `renderer = ["force2d"]` — exactly one value. | `sigma-graph.tsx`, `fa2-layout.ts`, seed/migration in `tools/kb/src` |
| 4 | **Fix every display-space→viewport conversion.** Replace `graphToViewport(getNodeDisplayData(...))` with `framedGraphToViewport(...)` at the hover-tooltip site and both cluster-hull sites. | **PC** | First hover on a node places the tooltip within 24 px of the cursor (today: 570 px, §1.1). | `sigma-graph.tsx`, `cluster-graph.tsx` |
| 5 | **Make cluster hulls visible.** Hull canvas above the sigma container (or a sigma layer); drop the imperative opaque `el.style.background`; padded-corner-point hulls (`pad ≈ 24`); `fill-opacity 0.04` / `stroke-opacity 0.25`; label above the cluster at `min(y) − pad − 8`; restore hit-testing so click-to-isolate fires. | **PC** | Hull painted bbox covers ≥60% of the bbox of its member nodes (today: a 50×42 px box for a full-canvas cluster); `document.elementFromPoint` inside a hull returns the hull canvas; clicking a hull isolates that cluster. | `cluster-graph.tsx` |
| 6 | **Fix the 3D cluster force.** Multiply the pull by the `alpha` argument; register per-axis under `d3Force('x'/'y'/'z')`; set them to `null` when distinct cluster keys < 2. | **PC** | With `cluster-by` unset, the post-settle position bounding box is non-degenerate (task 1's force3d assertion); with `cluster-by=parent`, distinct cluster centroids are separated by ≥ the mean intra-cluster radius. | `force3d-graph.tsx` |
| 7 | **3D fit + nav hint.** `zoomToFit(600)` after settle and on `0`/fit; `showNavInfo(false)`; invalidate the persisted camera when the node set changes materially. | **PC** | On mount, ≥80% of nodes project inside the viewport; the library hint element is absent. | `force3d-graph.tsx` |
| 8 | **One dim rule.** New pure `lib/graph-dim.ts` composing selection ∩ hover ∩ search ∩ filter into a single alpha per node/edge; delete `#444444`, `#666666`, `rgba(128,128,128,0.15)`. Includes the ~200 ms transition clock. Applied in sigma reducers and 3D colour accessors. | **PC** | Unit: alphas compose multiplicatively and are theme-independent (no hardcoded greys remain — grep assertion). Visual: filtering a tag leaves the *kept* set as the highest-contrast thing on screen in both themes, with labels forced on. | new `lib/graph-dim.ts`, `sigma-graph.tsx`, `cluster-graph.tsx`, `force3d-graph.tsx` |
| 9 | **`GraphCanvasFrame`.** Extract toolbar + legend + info chips + cap notice + empty/error states + keyboard map out of the force2d branch; renderers declare capabilities; the frame renders the intersection. | **PC** | Mount each of the four renderers: toolbar and legend present in all four; `f`, `0`, `Esc`, `/` handled in all four; unsupported controls rendered disabled, not absent. | `graph-page.tsx`, new `components/graph/graph-canvas-frame.tsx`, `graph-toolbar.tsx`, `graph-legend.tsx` |
| 10 | **Drag that moves nodes.** Set the graphology `fixed: true` attribute while dragging, clear on drop (keep it under Alt), bind move/up on `document`, and reheat on release. | **PC** | A programmatic 200 px drag moves the node's stored `x`/`y` by the equivalent graph delta, the node is still there after settle, and the camera does not pan. Today the same test shows zero movement (§1.2.4). | `sigma-graph.tsx`, `cluster-graph.tsx`, `fa2-layout.ts` |
| 11 | **Labels sized and truncated by rendered size.** New pure `lib/graph-label.ts` (`maxLen = max(4, floor(radius/2))`, font `max(6, min(12, r·0.6))`); remove the flat 40-char truncation from the extract so `LensNode.label` carries full text. | **PC** | Unit: truncation length is monotonic in node size; extract returns untruncated text. Visual: no label overlaps another at default zoom on the 126-node lens. | new `lib/graph-label.ts`, `lib/graph-lens.ts` (shared), renderers |
| 12 | **Tree navigability.** Make `Fit` actually fit (scale to content bbox, cap at 1); plain wheel zooms; selection parity via the frame (click selects, `Open` navigates); disambiguate click from pan; stop rendering raw ULIDs for empty-text nodes. | **PC** | A 2670 px-tall tree is fully inside the viewport after `Fit`; plain wheel changes zoom; clicking a node selects without navigating; no label matches `/^[0-9A-HJKMNP-TV-Z]{26}$/`. | `tree-graph.tsx` |
| 13 | **Settings popover + persisted lens props.** Toolbar `⚙` opening spread / link-distance / label-density / show-labels / curved-links / **cluster-by** / layout / autorotate; every control writes `sys.f.lens.*` via a new `mutations.setLensProp` that **unsets before setting**; only popover open state stays in React. | **PC** for `cluster-by` (its invisibility caused §1.0); **A** for the rest | Changing a control twice leaves exactly one value on the prop (today: `set` appends, §1.6); reload preserves every setting; `kb set` from the CLI moves the UI. | new `components/graph/graph-settings.tsx`, `actions/mutations.ts`, `lib/graph-lens.ts` (shared) |
| 14 | **3D scene configuration + select-in-place.** Link width by √weight, directional arrows, directional particles (1/4 at rest/selected), curvature toggle, `nodeResolution(24)`, sprite labels for top-N, autorotate, hover card with kb fields, and click = fly-to + select (never navigate). | **A**, but MUST-bearing (§4.3) | Clicking a node in 3D keeps you in 3D, eases the camera to it in ~1.2 s, and shows the same selection card as 2D; incident links carry moving particles; `Esc` clears. | `force3d-graph.tsx` |
| 15 | **Layout sub-modes.** New pure `lib/graph-layouts.ts` returning `Map<id,{x,y}>` for `radial` / `hierarchical` / `grid`; `force` delegates to the FA2 worker; selection persisted as `sys.f.lens.layout` and exposed in task 13's popover. `metro` explicitly not implemented. | **A** | Each mode is deterministic for a given fixture (snapshot of positions), assigns positions without starting the worker, and survives reload. | new `lib/graph-layouts.ts`, `sigma-graph.tsx`, `graph-settings.tsx` |
| 16 | **Guardrails.** (a) Assert no graph chunk except `force3d-graph-*` imports `three`; (b) assert every colour handed to the 3D renderer matches `/^(#|rgba?\()/` — the rule behind `3b1f82f`; (c) in-canvas error state replacing silent blanks, including `resolveNodeSet`'s `console.warn`-only path; (d) hull redraw throttled by tick count and a second adaptive tier for labels. | **PC** for (c), **A** for the rest | Bundle test fails if `three` leaks into `graph-page`; colour test fails on an `oklch()` token; a thrown renderer error draws a message inside the canvas frame and leaves the rest of the page interactive. | `components/graph/*`, `lib/graph-lens.ts` (shared), new bundle test |

**Cut order if the night runs short:** 1 → 2 → 3 → 5 → 6 → 7 → 8 → 9 are the
spine and together constitute "the graph is polished". 4, 10, 11, 12 are the
next tier of visible quality. 13, 14, 15, 16 are capability and can slip —
except 16(c), which should ride along with 9 since both touch the frame.

**Definition of done for i11:** open `/graph` on the seeded perspective and,
without pressing a key, see a fitted, labelled, legible graph; press `f` and
still see it; switch to Cluster and see labelled hulls you can click; switch to
Tree and reach the whole tree; switch to 3D and get a fitted, labelled,
orbitable scene where clicking a node keeps you in the scene. Every renderer
carries the same toolbar, legend and keyboard map.

---

## 6. Deliberately excluded

1. **Re-deriving the oklch/polished 3D colour bug.** Diagnosed and fixed on
   `main` in `3b1f82f` with tests; recorded in §1.5 as root-caused. My
   contribution there is only the *second*, independent cause (the cluster-force
   collapse), which the colour fix does not address.
2. **Isolating the drag no-op to a single line.** CONFIRMED as a no-op with two
   independent gestures (§1.2.4) and the pin mechanism identified
   (`fixed` attribute), but I did not instrument the handler to prove which of
   the two candidate causes dominates. Task 10 is written as a rewrite so it does
   not matter; a successor wanting the exact line should log inside
   `onMouseMove`.
3. **Performance validation.** r2 §6's budget table and i2's cut T10 remain
   unmeasured. This wave's evidence says correctness, not throughput, is what the
   owner is reacting to: 126 nodes rendered at interactive speed in every
   renderer that rendered at all. Deliberately deferred rather than half-measured.
4. **New lens types** — treemap, bundle, matrix, sankey, block. Ranked in the
   graphviz report §7 and still backlog. Adding a fifth renderer while three of
   four are broken would be malpractice.
5. **Multi-select and rubber-band.** Deferred by r2 §4 and still correctly
   deferred; nothing in the owner's signal points at it.
6. **`exportSVG`** (§3.6) and **CodeFlow's blast-radius graph theory**
   (§2 row 19) — rejected with reasons rather than silently dropped.
7. **The canvas page and the ontology graph scope.** Both touch
   `graph-page.tsx` and both were left alone; the ontology picker's interaction
   with perspectives was not audited (there were zero ontologies in the data).
8. **`metro` layout** — rejected on data-model grounds (§2 row 8).
9. **Dark theme sweep.** Every observation in §1 is from the light theme, which
   is what the running app defaulted to. The dim-colour finding (§1.2.2) is
   *worse* on light and would partly self-conceal on dark; the fix in task 8 is
   theme-independent either way, but a successor should re-run §1 in dark before
   claiming parity.
10. **The stale-lazy-chunk failure mode** (§1.5, last bullet) — noted, not
    pursued; it is a deploy-time concern, not a graph concern.

---

## 7. Sources

CodeFlow, `github.com/braedonsaunders/codeflow`, clone at `/tmp/codeflow-study`
at commit `4f0d944` ("Count circular deps and god objects from issue items"),
`index.html`, 10 838 lines. Every claim cited by line:

- `6475`, `6485`, `6488`, `6492` — ephemeral view state (`blastRadius`,
  `folderFilter`, `graphConfig`, `legendCollapsed`).
- `7712-7735` — `selectFile`: select in place, open details panel, compute blast.
- `7737-7748` — `updateGraphHighlight`: 200 ms opacity-based dim (0.2 nodes /
  0.05 links) and selection fills.
- `7955-7969` — `getNodeColor`, folder centre grid.
- `7970-7981` — `applyReadableLabels`, `d3.zoom().scaleExtent([0.08|0.2, 5])`.
- `7983-7986` — arrow marker `defs`; `hullLayer` / `linkLayer` / `nodeLayer`
  stacking order.
- `7989-8046` — the five layout sub-modes and their anchor-spring compositions.
- `8047-8051` — adaptive `alphaDecay`/`velocityDecay` at `nodes.length > 300`.
- `8052` — link width `max(1, min(2, √count · 0.3))`, opacity 0.4, arrow marker.
- `8055` — `d3.drag()` with `fx`/`fy` pin and `alphaTarget(0.1).restart()`.
- `8056-8058` — node click → select; cursor-relative hover tooltip;
  background-click clear.
- `8059` — node stroke as `d3.color(fill).brighter(0.3)`.
- `8061-8062` — label density gate; font size and **truncation length derived
  from node radius**.
- `8066-8082` — `updateHulls`: padded corner points, `d3.polygonHull`,
  `fill-opacity 0.04` / `stroke-opacity 0.25`, label above the cluster.
- `8084-8096` — hull tick throttle (`isLargeGraph ? 5 : 1`), curved-link arc
  path, node transform.
- `8098` — `try/catch` drawing `'Graph rendering error: …'` into the canvas.
- `8104-8134` — 3D guard on a missing library; node-identity preservation across
  updates.
- `8205-8218` — `ForceGraph3D({controlType:'orbit'})`, **literal hex**
  `backgroundColor`, `showNavInfo(false)`, `nodeResolution(24)`.
- `8220-8227` — HTML hover card via `nodeLabel`.
- `8228-8290` — selection-aware `linkColor` (non-incident at 0.08 alpha),
  `linkWidth`, `linkDirectionalArrowLength`, `linkDirectionalParticles` /
  `…Width` / `…Speed` / `…Color`.
- `8291` — `linkCurvature(0.25)`.
- `8292-8304` — `onNodeClick`: `cameraPosition(newPos, node, 1200)` fly-to +
  select; `onBackgroundClick` clear.
- `8306-8377` — sprite labels via `THREE.CanvasTexture` + `nodeThreeObject` +
  `nodeThreeObjectExtend(false)`.
- `8380-8389` — `controls().autoRotate`, `autoRotateSpeed 1.0`.
- `8392-8398` — `d3Force('link').distance`, `d3Force('charge').strength`.
- `8404-8418` — Fibonacci-sphere cluster centres at radius 180.
- `8420-8445` — `customForce` scaling by **`alpha`**; per-axis registration;
  **forces nulled when `groups.length === 0`**.
- `8447-8464` — `ResizeObserver`; teardown via `pauseAnimation()` + empty
  `graphData`.
- `8966-8997` — `zoomIn`/`zoomOut` (2D `scaleBy` 1.4/0.7 @200 ms; 3D camera
  vector ×0.7/×1.4 @400 ms); `resetZoom` (3D `zoomToFit(600)`).
- `8998-9018` — `computeGraphFitTransform` (screen-space, `min(scale, 2)`) and
  `fitView`.
- `9019-9027` — `exportSVG` with inlined theme variables.
- `9985-9991` — toolbar `+ − ⟲ ⊡ ⚙` with `aria-label`s.
- `9993-10025` — settings popover: layout buttons, `Spread` 50-500, `Links`
  30-200, show-labels, curved-links, auto-rotate.
- `10026-10042` — info chips, including the selection-relative
  "N dependents • N fns used".
- `10043-10054` — collapsible legend, top-12 + "+N more",
  `legend-item.active`, click → `filterByFolder` (a **data-set** filter).

Library sources, from `tools/kb/ui/node_modules` at the versions the app builds
against:

- `sigma@3.0.3` — `dist/sigma.esm.js:3423` (`framedGraphToViewport`),
  `:3485-3489` (`graphToViewport = framedGraphToViewport ∘ normalizationFunction`),
  `:1949`, `:2209`, `:2297` (internal use on display data), `:487-490`
  (mouse captor binds `mousemove`/`mouseup` on `document`).
- `graphology-layout-forceatlas2@0.10.1` — `helpers.js:144`,
  `iterate.js:21,698,744`, `webworker.js:33,710,756` — the **`fixed`** node
  attribute that makes drag-pinning possible.
- `three-render-objects@1.42.0` — `dist/three-render-objects.mjs:8`,
  `:676-678` (`parseToRgb` / `opacify` on `backgroundColor`), `:583`
  (`alpha: true`, why an unset clear colour reads as the page background).
- `kapsule@1.16.3` — `dist/kapsule.mjs:120-145` (deferred digest; prop
  `onChange` called synchronously in the setter).
- Versions and licences: `3d-force-graph@1.80.0` MIT, `three@0.185.1` MIT,
  `three-render-objects@1.42.0` MIT, `kapsule@1.16.3` MIT, `polished@4.3.1` MIT,
  `sigma@3.0.3` MIT, `graphology@0.26.0` MIT. Built chunk sizes:
  `force3d-graph-*.js` 1 374 842 B, `graph-page-*.js` 225 202 B.

Repo prior art read before starting: `reports/r2-graph.md` (including its
appended implementation handoff), `reports/i2-graph.handoff.md`,
`reports/r9-editor-deep.md` §7 (task-list shape),
`briefs/r10-graph-deep.md`. `.research/kb-refine/**` is **absent from this
worktree** — the graphviz report's "one graph, many lenses" principle was taken
from the brief's statement of it and from `tools/kb/DESIGN.md` /
`CLAUDE.md`, not from the original file.

Current implementation read in full: `components/graph/{sigma-graph,
cluster-graph,tree-graph,force3d-graph,graph-camera,fa2-layout,graph-toolbar,
graph-legend,graph-page,renderer-switch}.tsx|ts`, `lib/graph-lens.ts`,
`lib/css-color.ts`, `lib/tag-color.ts`.

*Report ends. No `tools/kb/**` file was modified. The CodeFlow clone is left at
`/tmp/codeflow-study` for i11.*
