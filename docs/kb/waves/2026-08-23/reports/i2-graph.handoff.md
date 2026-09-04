# i2-graph — Implementation Handoff

**Wave:** i2-graph (CodeFlow-parity graph overhaul)
**Branch:** `popemkt/kb-i2-graph`
**Agent sessions:** 2 (initial spine + polish pass)

---

## What shipped

All 18 MUST statements from §4 of `r2-graph.md` are implemented and verified:

### Selection & open (MUST 1–3)
- Single click selects node in-place: neighborhood stays lit, non-neighbors dim
  to ~15% alpha, bottom-left info card shows label, tags, degree, and Open/Focus
  buttons. Background click and Esc clear selection.
- Double-click, Enter (when selected), card Open button, and ⌘/Ctrl-click all
  navigate to the outline focused on that node.
- `f` key or card Focus button runs animated fit-to-neighborhood (300ms ease).

### Hover (MUST 4–5)
- Hover highlights neighbors + incident edges within one frame; non-neighbors dim.
- Tooltip card follows cursor showing label, tags, degree. Hidden when a node is
  selected to avoid visual clutter.
- Hover state never mutates graph data — nodeReducer/edgeReducer only.

### Drag (MUST 6–7)
- Dragging pins and moves node; on release, layout reheats (600ms FA2 burst).
- Works identically in force2d (sigma-graph.tsx) and cluster renderer
  (cluster-graph.tsx). Cluster hull redraws live during drag via afterRender.

### Camera / zoom (MUST 8–9)
- Toolbar buttons + keyboard: `+`/`=` zoom in, `−` zoom out, `0` reset, `f` fit
  view — all animated 200–400ms with easeOutCubic.
- Camera state survives data updates and theme switches (cameraRef pattern).
- Per-perspective positions cache (module-level Map keyed by layoutKey) restores
  layout when returning to a previously visited perspective.

### Search-in-graph (MUST 10–11)
- Toolbar search input (`/` focuses): filters rendered set by case-insensitive
  substring on label. Matches stay lit + labeled, non-matches dim. Enter cycles
  match focus with animated camera move. Clearing restores full graph.
- Search composes with tag-filter as intersection (both must pass for a node to
  show lit). Never rewrites the perspective query.

### Filtering (MUST 12–13)
- Collapsible legend (top-right) lists tag color buckets with counts. Clicking a
  bucket isolates/dims others via nodeReducer. Click again unhides. "Clear all"
  chip appears whenever any transient filter is active.
- Cluster hull click in the cluster renderer isolates that cluster (same
  mechanism); hull labels show member counts. Clear-filter chip for undo.

### Lens switching (MUST 14–15)
- Switching renderer applies a 200ms CSS opacity cross-fade (`graph-fade-in`
  keyframe) via keyed container remount.
- Positions cache keyed by perspective id: returning restores layout from memory.
- Renderer switch remains a persisted prop write (`mutations.setLensRenderer`);
  transient filters/search/selection never persist.

### Empty / large graphs (MUST 16–18)
- Empty result set renders centered guidance ("0 nodes match — edit this
  perspective's query to broaden the view").
- Invalid EDN renders a visible amber warning chip in the header with tooltip.
- When maxNodes caps the lens, a dismissible floating notice appears
  ("showing top N of M by degree") with an "edit max-nodes" button that navigates
  to the perspective node in the outline.
- >1500 nodes auto-enables degraded mode: hideEdgesOnMove, higher
  labelRenderedSizeThreshold (12 vs 7), lower labelDensity (0.5 vs 0.8).

### Supporting infrastructure
- **FA2 worker layout** (`fa2-layout.ts`): web worker with 2.5s auto-settle +
  synchronous rAF fallback via feature detection.
- **Animated camera** (`graph-camera.ts`): fitView, zoomIn/Out, resetCamera,
  focusNode — all cubic-eased 300ms.
- **Graph lens** (`graph-lens.ts`): tags[], degree, weight, queryError, label
  truncation (40 chars).
- **Cluster upgrades**: smooth padded Catmull-Rom hulls, member count labels,
  top-15 cluster cap, node drag with live hull, hull click isolation.
- **Tree upgrades**: pan/zoom via pointer events + wheel, Fit/Collapse/Expand
  toolbar.
- **Test harness**: WebGL2RenderingContext polyfill via bunfig preload so sigma
  tests pass in happy-dom environment.

---

## What was cut and why

| Item | Reason |
|------|--------|
| T8 (force3d parity pass) | Timeboxed out — 3D is exploratory, not primary nav surface per §4. |
| T10 (perf validation fixtures) | No synthetic 10k-node fixture committed; deferred to next wave. |
| Settings popover (sliders for spread/link-distance/labels) | FA2 API wired but no UI — interaction density already high. |
| Picker keyboard nav (↑↓/Enter) | Small UX gap, skipped for MUST interactions. |
| Multi-select | Explicitly deferred per §4 (I2+). |

---

## Shared-file touches

| Path | Change |
|------|--------|
| `tools/kb/ui/src/lib/graph-lens.ts` | +tags, +degree on LensNode; +weight on LensEdge; +queryError on LensGraph; label truncation; error propagation |
| `tools/kb/ui/src/lib/graph-lens.test.ts` | Updated edge assertions for weight field |
| `tools/kb/ui/package.json` + `bun.lock` | +graphology-layout, +graphology-layout-noverlap, +graphology-communities-louvain |
| `tools/kb/ui/vite.config.ts` | +setupFiles for test config |
| `tools/kb/ui/src/index.css` | +graph-fade-in keyframe |

---

## Follow-ups for later waves

1. Settings popover with live sliders (spread, link distance, label density)
2. force3d parity (zoomToFit on load, autorotate, selection particles)
3. Synthetic perf fixture (10k nodes) + budget regression tests
4. Picker keyboard navigation (↑↓/Enter)
5. Bundle regression test asserting sigma chunk doesn't pull three.js
6. Perspective "New…" button (creates #graph-perspective node via mutations)
7. Alt-held drag to permanently pin a node (currently all drags release pin)

---

## Self-grade vs quality bar

**A− / "CodeFlow-tier for the primary surface; gaps are named and bounded"**

The core force2d renderer now has the full CodeFlow interaction vocabulary:
select-in-place, animated cameras, worker layout, search+filter composition,
legend, arrows, drag, and tooltip. Every numbered MUST statement is implemented,
verified via typecheck + tests + lint. The cluster renderer got drag + hull
isolation (MUST 7/13). Cross-fade, position cache, and dismissible notices round
out the polish.

Remaining gaps: settings popover (discoverability of layout tweaks), force3d
untouched, no perf regression guard committed, picker keyboard nav skipped. These
are all documented follow-ups — none block the "CodeFlow-parity" headline.
