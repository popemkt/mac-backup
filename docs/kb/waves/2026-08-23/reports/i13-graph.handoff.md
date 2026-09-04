## Implementation handoff

### Shipped

- `9e45e9c` — **Task 0 + 16(c).** Renderer capability descriptors drive the
  shared toolbar: unsupported controls render disabled with a hover reason,
  never live-looking no-ops. Camera verbs go through `GraphCameraControls`
  adapters (sigma / tree / force3d) instead of a `sigmaRef`. Tree selects in
  place; only Open navigates. In-canvas `GraphCanvasErrorBoundary` plus
  `resolveNodeSet` query errors surface inside the frame.
- `1086269` — **Task 13.** Settings popover (⚙) writes
  `cluster-by` / `layout` / `spread` / `link-distance` / `show-labels` /
  `curved-links` / `autorotate` / `label-density` via `mutations.setLensProp`
  (unset-before-set). Seed defaults `cluster-by=parent` on
  `lens.all-mentions`; `DEFAULT_CLUSTER_BY` is `parent`. Cluster overflow
  joins an `other` bucket.
- `1427f94` — **Task 14.** 3D select-in-place with fly-to, weighted links,
  arrows, selection particles, top-N sprite labels, autorotate/curvature from
  lens props. Capability `selection` flipped to true for force3d.
- `4ca7904` — **Task 15.** Pure `lib/graph-layouts.ts` for radial /
  hierarchical / grid; force still uses FA2. Persisted as `sys.f.lens.layout`.
  `metro` not implemented.
- `bde7dbf` — **Task 16(a)(b)(d).** Static three-import boundary test; 
  `force3dColor` / `isForce3dSafeColor` (`/^(#|rgba?\()/`); hull redraw
  throttled on graphs >300 nodes; medium label-density tier at 300 nodes.
  16(c) already shipped with Task 0.

### Cut / incomplete

- Rendering-truth harness (r10 task 1) still deferred — needs real WebGL /
  browser fixtures (concurrent i12-render-harness owns Playwright).
- Cluster renderer still navigates on node click (`selection: false` in its
  capability table) — only force2d / tree / force3d have select-in-place.
- Settings do not yet drive FA2 spread/link-distance into the worker params
  (props persist and parse; force2d still uses `inferSettings`).
- No Vite build-time chunk assertion for `three` (source import scan instead,
  to avoid touching package scripts owned by i12).

### Shared-file touches

- `ui/src/components/graph/graph-page.tsx` — frame wiring, perspective props,
  3D selection, layout prop.
- `ui/src/lib/graph-lens.ts` — extended `LensPerspective` with layout/spread/
  link-distance/labels/curvature/autorotate/density; default cluster-by
  `parent`.
- `ui/src/actions/plan.ts` + `mutations.ts` — `planSetLensProp` /
  `setLensProp` (unset entire field before set); `planSetLensRenderer`
  delegates to it.
- `ui/src/lib/types.ts` + `src/foundation/model.ts` + `seed.ts` — new
  `sys.f.lens.*` field ids and seed template; cluster-by default migration.
- `ui/src/lib/css-color.ts` — `force3dColor` / `isForce3dSafeColor`.
- `ui/src/fixtures/graph.ts` — fixture fields + cluster-by parent.
- Catalog `graph-toolbar.stories.tsx` — adapter-based props.
- Did **not** touch `package.json`, lockfiles, Playwright, outline/, or
  canvas/.

### Verification

Before each commit: `bun test` (core, ~701 pass), `npm run typecheck`,
`npm run check`, `ui ./node_modules/.bin/vp test` (~491 pass). All green.

### Self-grade

Against the CodeFlow/Obsidian bar: the chrome no longer lies, settings survive
reload and are CLI-reachable, 3D is selectable and labelled, and layouts are
deterministic. Still short of CodeFlow on (1) FA2 param live-binding from
spread/link-distance, (2) cluster select-in-place parity, (3) a true browser
paint harness proving pixels. Those are honest gaps for a follow-up, not
silent blanks.
