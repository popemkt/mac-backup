## Implementation handoff

### Shipped

- `f48b0a0` — added Playwright (`chromium` only), `npm run test:render`, a
  Playwright configuration, ignored Playwright output, and a browser-level
  renderer harness.
- `74119a0` — made the fixture use the seeded all-mentions perspective id so
  opening its scratch data root cannot seed an additional graph perspective.
- `5c7f10c` — waits through the 3D simulation cooldown before evaluating its
  positional extent.
- `d653205` — activates Tree's Fit button through its native button API; the
  tree panning layer otherwise intercepts pointer clicks on its own controls.

The harness builds a deterministic 30-node fixture (one root, 28 children,
and the editable perspective) in a `mkdtemp` root. It first copies the repo's
`.kb`, then replaces only the *scratch* `nodes.jsonl`; `kb ui` serves that copy
on `127.0.0.1:4323`. Renderer changes therefore persist only in `/tmp`, never
in the tracked `.kb`. The Playwright global teardown owns and stops that exact
server.

Assertions are rendered-browser assertions, not happy-dom assertions:

- force2d and cluster inspect Sigma display positions (all 30 must fall in the
  viewport) and read `canvas.sigma-labels` pixels;
- cluster reads the hull canvas and requires its painted box to cover at least
  60% of the member-node box in both dimensions;
- tree requires all 30 SVG nodes and an SVG/content intersection after Fit;
- force3d checks `graphData().nodes.length === 30` and, after cooldown, a
  position extent greater than 1.

### Required red-proof evidence

All reverts were applied with `git revert --no-commit`, exercised, and aborted;
none remain on this branch.

| Reverted fix | Result |
| --- | --- |
| `131877c` camera framed-space fix | force2d red: viewport coverage was `0 / 30` (expected `30 / 30`). |
| `70c7184` 3D cluster-force fix | force3d red: maximum post-cooldown extent was `0.0000037681097531105934` (required `> 1`). |
| `96fe4ed` hull projection/stacking fix | cluster red: hull height was `48 px`; member-node height was `123 px`, so it missed the 60% (`73.8 px`) requirement. |
| `3b1f82f` oklch-to-rgb fix | **Not reproducible in the installed Chromium 151.** Reverting it still passed: this Chromium serializes the computed `oklch()` probe color to `rgb()`, so the historical `polished` throw no longer occurs. The old implementation is restored after the abort, but this is not proof of the historical failure. Do not represent this assertion as demonstrated until it is run with a browser that preserves `oklch()` in computed style or a separately approved browser-compatibility injection is added. |

### Test-only product hooks (loud)

These are the smallest hooks required to inspect renderer-internal state that
has no DOM representation. Each is active **only** in a Vite
`test-render` build and is removed at renderer cleanup:

- `tools/kb/ui/src/components/graph/sigma-graph.tsx` — exposes Sigma on its
  host as `__kbSigma`.
- `tools/kb/ui/src/components/graph/cluster-graph.tsx` — exposes Sigma on its
  host as `__kbSigma`.
- `tools/kb/ui/src/components/graph/force3d-graph.tsx` — exposes ForceGraph3D
  on its host as `__kbForceGraph`.

These touch files owned by i13's graph zone solely because the specified
assertions cannot otherwise read Sigma display positions or `graphData()`.
No production renderer behavior changed.

### Verification

- `cd tools/kb && bun install && bun test` → **680 pass / 0 fail**.
- `cd tools/kb/ui && bunx npm@12 run typecheck` → clean. The system `npm`
  binary is v10.9.8 and correctly rejects this repo's required npm 12 engine;
  npm 12 was therefore used for the prescribed scripts.
- `bunx npm@12 run check` → **0 errors, 20 pre-existing warnings** in
  untouched outline/graph/library files (including unused `useCallback` and
  `onClusterFilter` in `cluster-graph.tsx`).
- `./node_modules/.bin/vp test` → **470 pass / 0 fail**.
- `npm run test:render` (via the project Bun script) → **4 pass / 0 fail**.
- `git status --short` has no browser download or Playwright-output files;
  downloaded Chromium remains outside the repository.

### Pre-commit decision

Do **not** add `test:render` to pre-commit. It builds the whole UI, launches
Chromium, and waits for the 3D cooldown; pre-commit already carries expensive
Nix and kb checks. Put it in required CI for UI/graph changes (with a
nightly/manual full-browser run if CI capacity is constrained), while keeping
the existing `vp test` path fast for local commits.

### Self-grade

The suite now measures painted output and internal renderer state against a
real browser without mutating tracked KB data, and it proved three current
fixes are necessary. The unresolved honest gap is `3b1f82f`: a newer Chromium
normalizes the CSS value before it reaches the old code, so this environment
cannot reproduce the historical parser failure.
