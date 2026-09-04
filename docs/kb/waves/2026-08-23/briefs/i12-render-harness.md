# Brief i12-render-harness — a test that fails when a renderer goes blank

Harness: codex. Protocol:
`docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

## Why this exists

r10 §5 task 1. It is the one task i11 refused, correctly: r10's acceptance
needs *painted-pixel* evidence, and `vp test` runs happy-dom, which cannot
paint. i11 declined to write a unit test that could pass while a renderer is
blank — do not undo that judgment by writing one now.

This wave exists because three of the four graph renderers were "built and
broken in a way no test caught": force2d painted nothing on load, cluster hulls
were never once visible, and 3D threw inside kapsule and rendered an empty
viewport. Every one of those was found by a human driving a browser. Your job
is to make a machine do it.

**The owner has approved committing Playwright as a dev dependency for this.**

## Normative input

`docs/kb/waves/2026-08-23/reports/r10-graph-deep.md` — §1 for what each
renderer's failure actually looked like (these are your test cases), §5 task 1
for the assertions. Also read `reports/i11-graph.handoff.md` for what i11
shipped, and `reports/i2-graph.handoff.md`.

## What to build

Playwright, chromium only (`npx playwright install chromium` — do **not**
install all three browsers; disk on `/` is not abundant). Wire it as its own
script (e.g. `npm run test:render`) so the fast `vp test` suite stays fast.

Per renderer — force2d, cluster, tree, force3d — mount a **fixed fixture
graph** (~30 nodes), let layout settle, and assert the renderer actually
painted:

- **sigma (force2d, cluster):** ≥90% of node display positions inside viewport
  bounds, and `canvas.sigma-labels` painted-pixel count > 0. Read pixels back
  from the canvas; do not trust the DOM.
- **cluster additionally:** hull painted bbox covers ≥60% of the bbox of its
  member nodes. r10 measured a 50×42 px hull speck inside a 1220×856 canvas —
  that must be a failure.
- **tree:** SVG node count equals fixture size, and the content bbox
  intersects the viewport after `Fit`.
- **force3d:** `graphData().nodes.length` equals fixture size and the
  post-settle position bounding box is **non-degenerate** — r10's collapse
  showed every node at one point, so a degenerate bbox must fail.

## Prove the harness has teeth — this is the deliverable, not the tests

A harness that passes on a broken build is worthless, and most of the bugs it
targets are now **fixed on main**, so a green run proves nothing by itself.
For each assertion, demonstrate it goes red against the corresponding break,
and record the evidence in your handoff:

- revert `131877c` (camera framed-space) → force2d paint assertion must fail
- revert `3b1f82f` (oklch→rgb) → 3D must fail (it threw in `polished`)
- revert i11's 3D cluster-force fix → 3D bbox must be degenerate
- revert i11's hull projection/stacking fix → hull coverage must fail

Do this on scratch commits you then discard; **do not leave any revert on your
branch.** If an assertion cannot be made to fail, say so plainly — that means
it is not measuring what it claims.

## The data-root trap — read this before running the UI

Switching renderers is a **persisted prop write** (`mutations.setLensRenderer`
writes `sys.f.lens.renderer` to `.kb/nodes.jsonl`). r10 hit this and solved it
correctly: it served `kb ui` on **port 4322 against a copy of `.kb`** in a
scratch dir rather than driving the tracked one, so the test run could not
mutate a committed file. Do the same — your fixture and server must never
touch the repo's real `.kb`. A test suite that dirties tracked data on every
run is not shippable.

Also note port 4321 is usually occupied by the owner's live UI. Pick your own
port and do not kill theirs.

## Zone

New test dir (e.g. `tools/kb/ui/tests-render/**`), `playwright.config.ts`,
`tools/kb/ui/package.json` + `package-lock.json` + `bun.lock`, a `.gitignore`
entry for Playwright output, and your handoff.

**Do not edit `components/graph/**` or `lib/graph-*.ts`** — a concurrent wave
(i13-graph) owns those. You may read them freely. If an assertion is
impossible without a product change (e.g. a missing test hook or
`data-testid`), add the smallest possible hook and **list every such edit
loudly** in your handoff so i13 can rebase; prefer querying what already
exists.

Do not commit downloaded browsers. Confirm `git status` is clean of them.

## Verify

```bash
cd tools/kb && bun install && bun test
npm run typecheck
npm run check
cd ui && ./node_modules/.bin/vp test
npm run test:render     # your new suite
```

Baseline: core 680 pass / 0 fail, typecheck clean, lint clean, UI 470 pass / 0
fail. Any failure in the first four is yours.

## Decide and record

Say in your handoff whether `test:render` should run in pre-commit. Given
pre-commit already runs full nix + kb checks, a browser suite probably should
**not** — recommend where it belongs instead, and make the fast path stay fast.

Handoff: `docs/kb/waves/2026-08-23/reports/i12-render-harness.handoff.md`.
