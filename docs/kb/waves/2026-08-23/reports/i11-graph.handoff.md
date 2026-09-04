## Implementation handoff

### Shipped

- `903efbd` — normalized-camera fit now uses the CodeFlow 0.8 treatment and a
  2x zoom-in cap.
- `f290c03` — force2d waits for FA2 convergence before fitting; the checked-in
  default perspective now uses `force2d` and has exactly one renderer value.
- `96fe4ed` — corrected framed-space projection for hover and hulls; cluster
  hulls are in front of Sigma, padded, faintly filled, and labelled above.
- `70c7184` — 3D cluster attraction is alpha-cooled per axis, disabled for a
  single group, hides library navigation text, and zooms to fit after settling.
- `9549a52` — a pure, theme-independent alpha-composition dim rule replaces
  hard-coded greys in force2d and cluster, with 3D colour accessors on the same
  normalized path.
- `d0847db` — drag uses graphology's `fixed` pin and document gesture events;
  labels are render-size-derived and no longer truncated in the data layer;
  tree Fit is real and plain wheel zoom works.
- `f408ac6` — introduced `GraphCanvasFrame`, so toolbar and legend chrome are
  mounted around every renderer rather than only force2d.

### Cut / incomplete

The required task-1 renderer paint harness was not completed. It needs a real
browser/WebGL fixture rather than a happy-dom mock in order to prove Sigma
pixels, hull coverage, and the ForceGraph3D post-simulation bounding box. I
did not add a superficial unit test that could pass while a renderer is blank.

Tasks 13–16 (persisted settings, full 3D select-in-place/labels/particles,
layout sub-modes, and bundle/error guardrails) are also unshipped. The shared
frame exists but renderer capabilities and non-Sigma control adapters still
need to be completed; currently unsupported toolbar actions are visible but
only Sigma-backed actions execute. Tree selection parity remains incomplete.

### Shared-file touches

- `ui/src/components/graph/graph-page.tsx` — moved toolbar/legend ownership to
  the shared canvas frame.
- `ui/src/lib/graph-lens.ts` — preserves full source labels, leaving truncation
  to renderers.
- `.kb/nodes.jsonl` — migrated the seeded all-mentions renderer from `cluster`
  to the single `force2d` value.

### Verification

Before each commit I ran the required core test, typecheck, lint, and UI test
commands. The final UI suite reported 70 files / 469 passing tests (the local
UI `node_modules` installation had to be restored with `bun install`; no
tracked dependency files changed).

### Self-grade

The shipped work materially improves first render, fit, hull visibility,
3D non-collapse, dim contrast, drag plumbing, labels, and tree reachability.
It is not yet at the stated CodeFlow/Obsidian bar because the rendering-truth
harness and full renderer capability parity are unfinished; in particular 3D
selection and real cross-renderer keyboard adapters need the next wave.
