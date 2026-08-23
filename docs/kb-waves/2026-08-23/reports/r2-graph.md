# r2-graph — Graph view: CodeFlow-parity overhaul plan

Agent: opencode (r2). Research only — no implementation, no commits.
Sources studied: `.research/kb-refine/graphviz/report.md` (CodeFlow study, R6),
`.research/kb-refine/nxus/report.md` (R2), `.research/kb-refine/viz/report.md`
(R5), `tools/kb/INSPIRATIONS.md`, `tools/kb/DESIGN-REFINE.md` §W6, current
implementation under `tools/kb/ui/src/components/graph/**` +
`tools/kb/ui/src/lib/graph-lens.ts`, and a fresh CodeFlow clone at
`/tmp/codeflow-study` (index.html ~10.8k lines re-verified line-level for this
report). Latest npm versions verified 2026-08-23.

Locked principle (graphviz report §4): **one graph, many lenses** — every viz =
datalog query → `{nodes, edges}` → renderer. Nothing below changes the data
plane (`/api/graph` + `/ws` stay the only shared surface; renderers are pure
clients).

---

## 1. Gap analysis — kb today vs CodeFlow

### 1.1 Renderer-by-renderer

**force2d (`sigma-graph.tsx`, sigma v3 + graphology + FA2)**

| Dimension | CodeFlow | kb today | Gap |
|---|---|---|---|
| Layout | Live d3-force sim with drag-reheat; 5 layout sub-modes (force/radial/hierarchical/grid/metro); adaptive decay for >300 nodes | One-shot synchronous `forceAtlas2.assign` ≤120 iterations at mount (`sigma-graph.tsx:89-98`) | **High** — layout is frozen after mount: no settle animation, no interactivity during layout, no re-heat on change. This is the single biggest "feel" gap. |
| Node drag | Yes (fx/fy pinning + sim restart) | None | **High** — users instinctively try to drag nodes first. |
| Hover | Neighbor highlight + dim + rich tooltip (name/functions/layer/churn), animated transitions (~200ms) | Neighbor highlight + dim exists (`applyHover`, sigma-graph.tsx:133-161) but no metadata tooltip, no transitions | **Medium** — mechanism right, feedback shallow. |
| Select | Click = select in place (color/size/blast-radius recolor); background click clears; separate file panel opens | Click **navigates away to the outline** (`graph-page.tsx:100-103`). No selection state exists in-graph | **Critical** — the most-used interaction in every prior-art graph (Obsidian/Logseq/CodeFlow) is *select and explore*, not *leave*. |
| Camera/zoom | Toolbar: +/−/reset/fit with animated transitions (400ms); fit computes bounding box | Only wheel/pinch via sigma defaults; no buttons, no fit-view action, no animated camera moves | **High**. |
| Labels | Size-scaled by node radius, truncated to ≤18 chars, density-aware hide for large graphs | `labelRenderedSizeThreshold: 8` only; labels are **untruncated node text** (`extractLensGraph`: `label: wire.text || id`) — long markdown text renders as giant single-line labels; overview zoom shows an unlabeled dot field | **High** — truncation bug is user-visible polish debt today. |
| Edges | Aggregated by pair, width ∝ √count, curved-link toggle, directional arrows | Flat size-1 edges, no arrows (directed mentions render as undirected!), no kind distinction (mention/child/ref-prop all identical), multi-graph duplicates possible | **High** — directionality is information loss. |
| Filtering | Legend click → folder subgraph filter; search box; colorMode switch | Perspective query (persisted) + sys-node elide toggle only. No transient in-graph filter/search | **High**. |
| Chrome | Floating canvas toolbar, collapsible legend (top-right), info chips (files/links/dependents), settings popover (spacing/linkDist sliders, display toggles) | Header strip only: sidebar toggle, perspective picker, renderer pills, sys toggle, raw counts | **High** (see §5 sweep). |

**tree (`tree-graph.tsx`, d3-hierarchy + SVG)** — collapse circles work;
click navigates away; pan/zoom absent entirely (raw `overflow-auto` scrolling);
no fit-view, no expand/collapse-all, no focus breadcrumb. CodeFlow's dendro has
zoom/pan + click-filter integration. Gap: **medium** (mechanism solid,
navigation crude).

**cluster (`cluster-graph.tsx`)** — attractor-ring pre-layout + FA2 + convex-hull
canvas overlay with labels. Solid start. Gaps vs CodeFlow disjoint mode:
hulls are sharp polygons vs padded/smooth hulls; cluster label sits at centroid
(overlaps nodes); clicking a hull does nothing (CodeFlow arcs/blobs filter);
no per-cluster counts; cluster key cardinality uncapped (`resolveClusterKey`
on a high-cardinality prop → hundreds of one-node clusters). Gap: **medium**.

**force3d (`force3d-graph.tsx`, 3d-force-graph 1.80)** — has Fibonacci-sphere
cluster forces (CodeFlow parity ✓), position/camera persistence ✓. Missing vs
CodeFlow graph3d: fit-to-view on load (`zoomToFit`), autoRotate toggle, curved
links, directional particles on selected links, link width by weight, custom
label sprites (off by default there too). Gap: **low-medium** — 3D is
exploratory, not primary navigation (verdict in §3).

**Cross-cutting**

- **Remount churn:** every debounced extract produces new array identities →
  the whole `Graph` + `Sigma` instance is killed/rebuilt per edit batch
  (camera rescued via ref). Wasteful; diff-update instead.
- **Invalid lens query:** failed EDN only `console.warn`s → silent empty black
  canvas (`resolveNodeSet`, graph-lens.ts:341-351). No UI error surface.
- **maxNodes cap:** drops lowest-degree nodes with `console.warn`; header shows
  `−N` but nothing explains the rule or how to widen it.
- **Empty states:** "No graph perspectives seeded." text; a query matching 0
  rows renders a blank canvas with only header counts.
- **Keyboard:** zero keyboard support on the page (no Esc, ±, f).
- **Perf:** sync FA2 blocks main thread (fine at 500 nodes, seconds at 5k+).

### 1.2 What CodeFlow gets right that kb should copy wholesale

1. Select-in-place with blast-radius-style neighborhood coloring + background-click clear.
2. Animated camera verbs: zoom in/out/reset/fit as first-class toolbar buttons.
3. Settings popover with live-applied sliders (spread / link distance / labels / curvature).
4. Collapsible legend that doubles as a filter.
5. Info chips that explain what you're looking at (counts, cap, selection impact).
6. Adaptive simulation params by graph size (alphaDecay/velDecay, hull throttle).

### 1.3 Where kb must beat CodeFlow (already locked or available)

- Perspectives are persisted queryable sys-nodes (CodeFlow's colorMode/viewMode are ephemeral React state) — keep, extend.
- Configurable `cluster-by` (tag/prop/parent) vs CodeFlow's hardcoded folder.
- Smart-elide of sys/schema scaffolding with toggle — unique, keep.

---

## 2. Renderer & layout decision

### Primary path (recommended): deepen sigma.js v3 + graphology + FA2-in-worker

Stay on the installed stack (`sigma@3.0.3`, `graphology@0.26.0`,
`graphology-layout-forceatlas2@0.10.1`) and upgrade the **layout orchestration**:

- Replace mount-time `assign()` with the same package's web-worker driver:
  `import FA2Layout from "graphology-layout-forceatlas2/worker"` → `new FA2Layout(graph, {settings})`,
  `.start()/.stop()/.kill()/.isRunning()`. Layout animates live while the main
  thread stays free; stop on convergence timeout (~2s) or user interaction;
  restart briefly ("re-heat") on drag/topology change.
- Port CodeFlow's layout sub-modes as **presets** over the same engine:
  `force` (FA2 default), `radial` (`circular` init from `graphology-layout`),
  `hierarchical` (column x-positions by tag/type order → light FA2 polish),
  `grid` (grid init + strong fx/fy). Persisted as `sys.f.lens.layout` prop on
  the perspective node (kb rule: UI actions reachable through data).
- Post-pass collision cleanup with `graphology-layout-noverlap`.
- Sigma tuning for the "Obsidian feel": `EdgeArrowProgram` for directed kinds,
  label density/threshold tuning, `hideEdgesOnMove` above size thresholds,
  custom `defaultDrawNodeHover` card.

Justification: quality (animated settle + drag = the entire perceived-polish
delta), bundle size (zero new heavy deps; three.js already quarantined in its
own lazy chunk), maintenance (all packages actively maintained under the
graphology org; used by Obsidian-class prior art per R5), license (MIT across
the stack).

**Fallback:** if the worker fails to bundle/run in the `vite-plus` build
(vite 7-era worker syntax — verify in T1 spike), degrade gracefully to
synchronous `assign()` chunked across `requestAnimationFrame` slices behind a
feature flag (`const USE_WORKER = detectWorkerSupport()`), keeping all other
polish. The component API stays identical either way.

### Rejected / deferred alternatives

| Option | Verdict | Why |
|---|---|---|
| Hand-rolled force layout status quo | Reject | No animation/interactivity; reimplementing FA2 badly. |
| elkjs 0.12.0 | Reject | EPL-2.0/GPL dual license (repo standard is MIT-family), ~1MB bundle, layered-diagram family — wrong tool for organic knowledge graphs. |
| d3-dag 1.2.2 (MIT) | Defer | d3-hierarchy covers tree/treemap needs; a true layered-DAG lens (ref-prop flows) is speculative. Revisit only if such a lens ships. |
| @react-sigma/core 5.0.6 | Skip now | Current imperative sigma integration works; adding React bindings mid-overhaul is churn without user-visible gain. Revisit if graph routes multiply. |
| @antv/g6 5.x (WebGPU, MIT) | Watch-list | Framework-scale swap displacing sigma; violates simplicity rule; unnecessary at our scale targets. WebGPU force layouts remain a watch item for >50k-node futures. |
| Cosmograph | Standing reject | CC-BY-NC license (locked in R5/§W6). |

Tree keeps d3-hierarchy (ISC); treemap/bundle/block/matrix/sankey lenses remain
backlog exactly as ranked in the graphviz report §7 — none block parity on the
four shipped renderers.

---

## 3. Dependency proposal (exact packages + versions)

Keep (already in `tools/kb/ui/package.json`):

```
sigma@^3.0.3                    MIT
graphology@^0.26.0              MIT
graphology-layout-forceatlas2@^0.10.1   MIT   (includes /worker entry)
d3-hierarchy@^3.1.2             ISC    (+ @types/d3-hierarchy@^3.1.7)
3d-force-graph@^1.80.0          MIT    (lazy chunk only)
```

Add (all tiny, MIT, maintained):

```
graphology-layout@0.6.1                 MIT  — circular/circlepack/random presets
graphology-layout-noverlap@0.4.2        MIT  — post-layout de-overlap pass
graphology-communities-louvain@2.0.2    MIT  — optional cluster-by:auto (Louvain)
```

Explicitly not added: `elkjs@0.12.0` (license/bundle), `d3-dag@1.2.2` (defer),
`@react-sigma/core@5.0.6` (skip now), `three` (pulled transitively by
3d-force-graph only, must stay out of the graph-page chunk — existing invariant,
add a regression test asserting the sigma chunk never imports three).

---

## 4. Interaction spec (MUST statements)

"Polished" = each statement below is testable or demoable. Numbering for task refs.

**Selection & open (highest priority)**
1. MUST: single click on a node selects it in place — neighborhood stays lit,
   non-neighbors dim to ~15% alpha, a node info card appears (bottom-left:
   label, tags, degree, first-line preview) with an explicit **Open** affordance.
   Background click clears selection (Esc too).
2. MUST: double-click (and Enter when selected, and the card's Open button)
   navigates to the outline focused on that node (`navigate("/") + zoomTo(id)`).
   ⌘/Ctrl+click opens immediately (power path).
3. MUST: selected node gets camera attention option: `f` or card button runs an
   animated fit-to-neighborhood (≤400ms ease).

**Hover**
4. MUST: hover highlights neighbors + incident edges within one animation frame
   budget; dimming applies to nodes AND edges; hover shows a lightweight tooltip
   card (label, tags, degree) that follows the cursor and disappears on leave.
5. MUST: hover state never mutates the underlying graph data (reducers only).

**Drag**
6. MUST: dragging a node pins and moves it, lightly reheats layout locally
   (short worker burst or alpha bump), releases pin on drop unless Alt held.
7. MUST: drag works identically in force2d and cluster renderers (cluster keeps
   its hull overlay live-updating during drag).

**Camera / zoom**
8. MUST: toolbar buttons + keyboard: zoom in (+/=), zoom out (−), reset (0),
   fit view (f) — all animated 200–400ms; fit computes node bounding box with
   padding (CodeFlow `computeGraphFitTransform` pattern).
9. MUST: camera state survives data updates and theme switches without jumps
   (existing behavior — preserve through the refactor).

**Search-in-graph**
10. MUST: a search input (toolbar; `/` focuses it) filters the rendered set by
    case-insensitive substring on label: matches stay lit + labeled, non-matches
    dim; Enter cycles match focus with animated camera move. Clearing restores.
11. MUST: search composes with tag-filter (intersection), never rewrites the
    perspective query (transient layer only).

**Filtering**
12. MUST: legend (top-right, collapsible) lists color buckets (tags by default)
    with counts; clicking a bucket isolates/dims others client-side (nodeReducer),
    click again unhides; "clear" chip appears whenever any transient filter is
    active. Filters are ephemeral UI state — NOT written to the perspective node.
13. MUST: cluster hull click isolates that cluster (same mechanism); hull labels
    show member counts.

**Lens switching**
14. MUST: switching perspective or renderer animates a short cross-fade
    (≤200ms CSS opacity) and resets camera to fit; positions cache keyed by
    perspective id so returning to a lens restores its layout (existing pattern —
    generalize to per-perspective caches).
15. MUST: renderer switch remains a persisted prop write (existing
    `mutations.setLensRenderer` — CLI/backend source-of-truth preserved);
    transient filters/search/selection never persist.

**Empty / large graphs**
16. MUST: empty result set renders centered guidance ("0 nodes match — edit this
    perspective's query"), not a blank canvas; invalid EDN renders a visible
    warning chip in the header (never console-only).
17. MUST: when maxNodes caps the lens, show a dismissible notice
    ("showing top N of M by degree · edit max-nodes") whose button navigates to
    the perspective node in the outline.
18. MUST: >~1.5k nodes auto-enables degraded mode (hideEdgesOnMove, lower label
    density, noverlap skipped) without user configuration.

**Multi-select**: deferred (I2+). Sketch for the record: Shift+click toggles
membership in a compare-set; dim logic = union of neighborhoods; card becomes a
stack. Rubber-band is explicitly out of scope. Rationale: single-select covers
the CodeFlow/Obsidian bar; multi-select drags in undo/interaction edge cases
the simplicity rule says to defer.

**Keyboard map (summary)**: `/` search · Esc clear/close · f fit · 0 reset ·
+/= , − zoom · Enter open selected · ⌘click open · arrows reserved (future).

**3D stance**: keep force3d as the exploratory wow-mode, polished cheaply
(fit-on-load, autorotate + curved-links toggles, selection particles — all
direct ports of CodeFlow's graph3d config), but do not invest beyond parity;
it is not a primary navigation surface.

---

## 5. Sweep mandate — chrome audit beyond the brief

Findings from auditing `graph-page.tsx`, `perspective-picker.tsx`,
`renderer-switch.tsx` against nxus skin rules (DESIGN-RESKIN §0) and CodeFlow:

1. **Header overload** — nav, title, picker, renderer switch, sys toggle, raw
   counts, prefs crammed into h-11. Move canvas tools (zoom/search/settings)
   into a floating toolbar over the canvas (CodeFlow pattern); header keeps
   nav/picker/renderer/sys/counts.
2. **PerspectivePicker** is mouse-only (no ↑↓/Enter), shows no stats, offers no
   create/edit affordances. Polish: keyboard nav, per-perspective `N·M` count
   preview, trailing "+ New perspective…" item that creates a `#graph-perspective`
   node via mutations and navigates to it (editing stays kb-idiomatic: zoom the
   node).
3. **sys on/off toggle** is cryptic bare text and resets on unmount (component
   `useState`). Make it localStorage-backed like expanded-ids and give it an
   icon+tooltip.
4. **Counts chip** is unexplained when capped — fold into MUST 17's notice.
5. **No legend anywhere** except implicit cluster hull labels (fixed by MUST 12).
6. **No loading indicator** during the 300ms debounce/layout — mostly fixed by
   worker layout; add a subtle "settling…" shimmer only if still noticeable.
7. **Accessibility gaps**: picker popover lacks listbox arrow-key handling;
   toolbar buttons need aria-labels (nxus parity); focus rings per skin tokens.
8. **Theme flicker**: themeKey remount re-reads token colors — fine, but ensure
   the new hover-card/legend read tokens reactively (same readTokenColor +
   key pattern), else dark-mode flash.

---

## 6. Performance notes / budget

Targets (measured on fixture graphs; see T10):

| Scale | Expectation |
|---|---|
| Default lens ≤500 nodes / ≤2k edges | 60fps pan/zoom/hover; first layout settled ≤1.5s animated; zero main-thread block >50ms |
| Comfortable ≤2k nodes / ≤10k edges | Worker FA2 + Barnes-Hut; 60fps interaction; hover refresh ≤8ms |
| Stretch 10k nodes / ~40k edges | Degraded mode (MUST 18): hideEdgesOnMove, labelDensity ~0.5, constant edge thickness, throttled reducers; ≥30fps on M-series |

Budgets and mechanics:

- Frame: 16.6ms. Sigma WebGL draw of 10k/40k ≈ 4–8ms GPU-bound; keep JS between
  frames minimal. Worker posts positions; throttle `refresh()` to rAF.
- Reducers: called per refresh — never rebuild closures per frame; memoize dim
  sets as plain Sets checked inside reducers (current applyHover pattern is OK,
  but must be throttled and allocation-light at scale).
- Extract (`extractLensGraph`) ≤50ms @5k nodes: mention pairs come from datalog
  per rev — cache `{nodes,edges}` per `(rev, perspectiveId)`; debounce stays 300ms.
- Multi-edge overhead: prefer deduping parallel edges at extract (weight attr)
  once arrows/kinds land; keep `multi:true` only if kind-per-edge demands it.
- Cluster hulls: redraw on `afterRender` is fine ≤1k nodes; throttle to every
  other frame above that.
- Regression guard: add a bundle test asserting `sigma`/graph chunks never pull
  `three` (protects the lazy-load invariant).

---

## 7. Task breakdown (one overnight wave, ordered)

Zone: i2-graph owns `tools/kb/ui/src/components/graph/**` + own tests. Note:
`lib/graph-lens.ts` lives outside the zone — treat edits there as shared-file
touches listed in the handoff note (they're graph-specific, low collision risk).

| # | Task | Files | Risk |
|---|---|---|---|
| T1 | **Worker layout spike + fallback flag.** Integrate FA2 worker; verify vite-plus bundles it (dev+build); wire fallback detection. Decide USE_WORKER here. | `components/graph/sigma-graph.tsx`, new `components/graph/fa2-layout.ts` | **Highest risk — do first.** Fallback: rAF-chunked assign. |
| T2 | **Extract hardening.** Truncate labels (≤40 chars + ellipsis, single line), edge dedupe→weights, deterministic sort, expose meta {tags, degree}; cache per (rev,perspective). Unit tests. | `ui/src/lib/graph-lens.ts` (shared-file note), `graph-lens.test.ts` | Low |
| T3 | **SigmaGraph v2 core.** Persistent instance w/ diff updates (no kill/rebuild per batch); worker-driven settle + stop-on-timeout; node drag + re-heat; EdgeArrowProgram colored by kind; label density/truncation settings; hover tooltip card; select-in-place + info card + open affordance + background/Esc clear; animated camera util (fit/reset/zoom). | `sigma-graph.tsx`, new `graph-camera.ts`, `graph-tooltip.tsx`, `selection-card.tsx` | Medium-High (drag+worker interplay, StrictMode double-mount discipline) |
| T4 | **Floating toolbar + settings popover.** Zoom/reset/fit buttons; sliders (spread/link distance), labels/arrows/density toggles applied live via setSetting (no remount). | new `graph-toolbar.tsx` | Low-Medium |
| T5 | **Legend + transient tag filter + search input.** Bucket counts from extract meta; isolate/dim via reducers; search box w/ cycle-focus; composition rules per MUST 11-13. | new `graph-legend.tsx`, `use-graph-filter.ts` (+ tests pure fns) | Medium |
| T6 | **Cluster upgrades.** Hull click-to-isolate, member-count labels, circlepack-per-cluster init, padded/smooth hulls, top-N cluster cap + "other". | `cluster-graph.tsx` | Medium |
| T7 | **Tree upgrades.** Pan/zoom wrapper + fit button, expand/collapse-all, focus breadcrumb; keep collapse circles. | `tree-graph.tsx` | Low |
| T8 | **force3d parity pass.** zoomToFit on load, autorotate/curved-links toggles, selection particles/link-width; reuse toolbar where trivially shareable, else skip. | `force3d-graph.tsx` | Medium (three.js API surface; timebox) |
| T9 | **Chrome states.** Empty-result guidance, invalid-query warning chip, cap notice (MUST 16-17), localStorage sys-toggle, picker keyboard nav + counts + "New perspective…". | `graph-page.tsx`, `perspective-picker.tsx`, new `graph-empty-states.tsx` | Low |
| T10 | **Perf validation + guards.** Synthetic fixtures 500/2k/10k; extract-budget unit test; three-chunk regression test; document measured numbers in this report's table (follow-up commit by orchestrator if needed). | tests + fixtures | Medium |

Sequencing: T1 → T2 → T3 are the spine (T3 depends on both). T4/T5 depend on
T3's camera/reducer utilities; T6-T9 are independent after T3 and can be cut
if the night runs long, priority order T9 > T6 > T4 > T7 > T8 > T5-remainder.
T10 last. Every task keeps `bun test`, `npm run typecheck`, `npm run check`,
`vp test` green per merge protocol.

Definition of done for the wave: a user can open `/graph`, drag nodes while the
layout settles smoothly, select a node without leaving the page, filter by tag
from a legend, find a node by search, and zoom/fit with animated controls —
i.e., the interactions §4 marks MUST all hold, and the default 500-node lens
feels effortless.

---

*Report ends. No code was modified; CodeFlow clone left at /tmp/codeflow-study
for implementers.*
