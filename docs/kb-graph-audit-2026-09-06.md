# kb graph usability audit — 2026-09-06

Review report, not a task backlog. Scope: the four graph renderers, shared frame,
settings, labels, camera controls, and existing render tests. This was a read-only
code audit by an Astra agent at medium reasoning effort. The repository admission
gate passed with soft missing tools. No browser reproduction or runtime tests
were performed, so findings describe code-supported defects, not verified visual
captures. No application files were changed by the auditor.

Paths and line numbers below refer to the source at review time. The graph-page
references were rechecked after the concurrent WorkspaceState changes.

## Findings

### P1 — White label plates conflict with dark-mode text

`tools/kb/ui/src/components/graph/sigma-graph.tsx:135` sets
`highlighted: emphatic`, including ordinary nodes when no focus/filter is active.
Sigma paints highlighted nodes using its default hover painter. The installed
`sigma/dist/index-fad77a13.esm.js:666` hardcodes a white plate and then paints text
using the configured label color. The app supplies `--foreground`, which is pale
in dark mode. This produces a concrete white-on-white path, not merely a suspected
token issue. Cluster isolation also uses `highlighted: true`.

Use one theme-aware label/hover presentation shared by both Sigma renderers.
Distinguish ordinary visibility from actual hover/selection emphasis.

### P1 — Search, legends, and settings promise unsupported behavior

Only Sigma receives search/filter sets in
`tools/kb/ui/src/components/graph/graph-page.tsx:324`. Tree, cluster, and 3D
advertise search but receive no search state; tree cannot focus a search result
either. `graph-canvas-frame.tsx` renders an interactive legend unconditionally.

`graph-settings.tsx:121` exposes spread and link-distance controls, but those
parsed perspective properties are consumed by no renderer. Show-labels, density,
and curves are applied only to 3D; layout is applied only to Sigma 2D, while the
settings UI exposes them in every renderer. The separate capabilities table is
therefore not an accurate contract.

Declare supported commands and settings on the renderer adapter, derive controls
from that contract, and pass a common interaction state into every renderer.
Unsupported settings should not appear as working controls.

### P1 — Cluster hull canvas intercepts graph input

`cluster-graph.tsx:301` enables pointer events on a full-viewport hull canvas.
At lines 394–396 it is layered at z20 above Sigma at z10. It intercepts clicks,
wheel events, and drag gestures throughout the viewport. Cluster node clicks also
navigate immediately instead of selecting in place as the graph design specifies.

Draw hulls behind Sigma with pointer events disabled; hit-test hulls from the
graph's background-click event. Route node selection through the common frame.

### P1 — Labels are deliberately limited to 4–10 characters

`tools/kb/ui/src/lib/graph-label.ts:1` derives label length from node radius.
`graph-lens.ts:539` gives fixed nodes size 5 and bounds other sizes to 3–20.
The helper therefore clips ordinary labels to four characters and even the
largest labels to ten. It is reused for external 2D, tree, and 3D labels, where
available text space is unrelated to node importance.

Replace radius-based truncation with measured screen-space text bounds, a useful
maximum width, collision-aware density, and full text on hover/selection. Tree
labels should wrap within measured columns and participate in layout bounds.

### P1 — Tree initial camera, bounds, and chrome are incomplete

`tree-graph.tsx:130` measures node centers plus 40px padding, excluding label
extents. Initial camera state is zoom 1/pan 0. `fitTreeView` at line 162 is
registered as a command but never invoked on mount, and there is no resize
observer. The SVG and container can clip content. Its top-left expand/collapse
controls occupy the same position as the shared legend.

Fit measured node-and-label bounds when the first layout is ready. Preserve
deliberate camera changes afterward and handle viewport resizing. The shared
frame should own placement of all controls, including renderer-specific ones.

### P2 — Interaction state and lifecycle have competing owners

- `sigma-graph.tsx:412` suppresses an effect dependency and claims lifecycle
  handlers read mutable refs, but handlers actually capture an older
  `refreshReducers`. Hover/click can restore stale search/filter styling.
- At line 122 an empty search-match set is treated as matching everything.
- Legend filters hold internal state and emit concrete IDs only when clicked.
  Data updates can leave stale membership. Renderer switches remount the legend
  while retaining parent filter IDs.
- Shared frame and Sigma both register global Enter/Escape handlers, without
  consistently excluding editable targets.
- 3D auto-fits whenever its engine stops (`force3d-graph.tsx:302`), potentially
  overriding deliberate navigation. Zoom scales camera coordinates about the
  world origin, not the current target; saved camera state omits that target.
- Renderers rebuild on data/theme changes. Sigma's topology key uses only node
  and edge counts above 200 nodes, missing topology changes with identical counts.

Use one frame-owned interaction controller with derived membership and scoped
shortcuts. Separate renderer creation, topology/layout updates, style updates,
and camera intent. Fit once unless explicitly requested or required by a new view.

## Cohesive implementation sequence

1. Establish one renderer contract covering implemented commands, supported
   settings, shared selection/search/filter state, and control placement. Remove
   dead setting paths and fix cluster hit-testing as part of this ownership work.
2. Establish one label presentation model and viewport-bounds model. Correct
   theme-aware painting, measured text, initial tree fit, resize behavior, and
   camera ownership together.
3. Stabilize renderer lifecycles so styling/data updates preserve camera and
   interaction state; implement remaining interaction parity against the contract.
4. Verify actual visible behavior across renderers, not just successful mounting.

Current tests encode or miss these defects: `graph-label.test.ts:10` explicitly
expects `abc…` for radius 8. `tests-render/render.e2e.ts:129` manually clicks Fit
and only checks that the tree SVG intersects its container, not that all nodes
and labels fit. Label checks count painted pixels without measuring contrast.

Acceptance coverage should include light/dark, DPR 1/2, narrow/wide viewports,
long labels, deep/multi-root trees, first load without clicking Fit, resizing,
search with zero and multiple matches, actual legend effects, node selection and
drag, editable keyboard focus, and live data updates. Assert full relevant text
bounds, usable contrast, and interaction outcomes.

## Crisp rendering and modern 3D direction

The package currently declares `3d-force-graph ^1.80.0` and accesses Three
transitively. This audit does not claim that these are the latest versions.

A direct, explicitly versioned Three.js renderer using WebGPURenderer and TSL is
a suitable playground prototype behind the same renderer contract. Validate
browser/GPU compatibility and fallback behavior before migration. TypeGPU should
enter only for a measured computation need, such as large force simulations;
otherwise it adds a competing compute abstraction. Blender can supply polished
glTF character assets without coupling those assets to graph semantics. A GPU
stack migration alone will not fix the interaction, text, or bounds defects above.

Visual acceptance criteria:

- Smooth node silhouettes and shading, with no unintended polygon faceting.
- Antialiasing and bounded DPR scaling; check both ordinary and Retina displays.
- Readable screen-space labels while zooming, without clipped or blurry text.
- Theme-aware contrast for ordinary, hovered, selected, and dimmed states.
- Stable geometry and camera behavior during resize, data changes, and selection.

The cluster hull canvas currently allocates only CSS-pixel dimensions and needs
a DPR-aware backing buffer. 3D labels use small fixed canvas textures scaled in
world space. Increasing sphere resolution alone will therefore not make the
overall view crisp.

## Implemented repair and verification

Astra at high reasoning effort implemented the following repairs after the
review. The original findings above remain the record of the pre-fix state.

- **Renderer ownership:** cluster is now a layout/decorative hull layer on the
  same Sigma renderer as force2d. Its hull canvas does not capture pointers;
  Sigma background clicks hit-test rounded hulls. Both modes share selection,
  drag, search, filtering, label paint and camera lifecycle.
- **Intent and selection:** the graph page stores the selected node ID and
  derives current metadata from the live projection. Click selects in place;
  Open and explicit Focus have separate, working meanings. The selected node
  and its incident relationships retain emphasis. All three edge carriers
  (child, text reference, field reference) use the same neighborhood mechanism.
  Search zero matches dims everything. Search input Escape closes search without
  clearing selection; graph shortcuts ignore editable controls and dialogs.
- **Identity and text:** cluster identities resolve to human node text before
  rendering. Inline reference labels use the existing rich-text parser; bare
  references resolve their target, and empty/missing labels read “Untitled.”
  Tag IDs remain distinct from tag display labels, so equally named tags do
  not merge in the legend. Live membership changes recompute filters; removed
  buckets cannot strand a hidden active filter.
- **Labels and pixels:** Sigma has theme-aware label and hover painters instead
  of the hardcoded white hover plate. Text is measured in screen space with a
  useful width budget, viewport clamping and per-frame collision rejection.
  Hover/selection metadata provides full text. Tree labels wrap completely
  within measured columns, and their extents participate in layout bounds.
  Hull canvases use a bounded DPR-aware backing store. 3D spheres have smooth
  32-segment geometry, antialiasing and bounded DPR; label textures scale to
  screen pixels using viewport height and camera field of view.
- **Camera and lifecycle:** Sigma and 3D instances survive ordinary data/theme/
  emphasis changes. Topology comparisons include actual IDs and edges at all
  sizes. Only initial force convergence may fit automatically, and deliberate
  camera interaction cancels that intent. 3D selection does not move the camera;
  explicit zoom uses the current orbit target, and explicit Focus preserves
  orientation. Tree fits its first measured layout and automatic resize, retains
  a deliberate camera, and expands ancestors when search focuses a collapsed
  node. Tree-specific controls live in shared chrome. Camera transitions honor
  reduced motion; reduced motion also disables autorotation.
- **Honest settings:** unsupported controls are disabled with a reason. Label
  visibility works in every renderer, density in both Sigma views and 3D,
  force layout choice in force2d, cluster grouping in Cluster, and spread,
  link distance, curvature and autorotation in 3D.
- **Atomic field replacement:** browser verification found a separate actual
  cause of first-click renderer failure: node.update applied setProps before
  unsetProps, erasing the newly set renderer. The action now removes old values
  before adding new values within the same atomic update. A persisted backend
  regression exercises all renderer replacements; the browser regression
  verifies the first switch survives reload.
- **Ready-state motion:** graph surfaces join the shared workspace reveal and
  the lazy 3D boundary uses WorkspaceBoundary. Selection cards use the shared
  finite surface entrance.

Verification performed on scratch data, with no live graph data changes:
targeted UI graph suites, backend atomic-replacement regression, TypeScript
checking, UI lint/check and test-render build. The six main graph browser tests
pass: force2d labels/framing; cluster labels/hulls; every tree label inside its
viewport on first load and resize plus collapsed-node search; 3D data and stable
nondegenerate volume; cluster selection/camera/search/filter behavior; and
first-attempt renderer persistence. A separate dark/Retina test checks DPR and
light glyph/dark outline pixels and records cluster, tree and 3D screenshots.
CUA visual inspection additionally confirmed rounded hulls, readable resolved
reference labels and absence of the previous white plates.

Limits: this is a repair of the current renderers, not a WebGPU/TSL migration.
3D density remains a top-N label budget; dense overlapping geometry may still
need deliberate focus to read every node. The browser fixture covers 30 nodes,
including multiple tree roots and long text, plus narrow resize and DPR 1/2;
it is not an exhaustive stress sweep over every user dataset or GPU.

Final production inspection exposed and corrected a 3D startup ordering fault: an
early reheat started the simulation before its deferred layout existed. Reheating
now waits for the first engine tick; initial data initializes the simulation.
3D label visibility now reserves screen-space rectangles each render, prioritizes
the active node, and excludes overlapping or offscreen ordinary labels. Sigma
and 3D share the rectangle reservation mechanism. The browser regression now
rejects runtime errors, requires the complete nonempty fixture, waits for reveal
animations, and checks actual renderer draw calls before capturing 3D evidence.
