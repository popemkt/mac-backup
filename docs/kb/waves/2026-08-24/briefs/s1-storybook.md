# Brief s1-storybook — one story format, and a viewer that renders it

Harness: omp. Protocol:
`docs/kb/waves/2026-08-24/briefs/impl-protocol.md`.

## Current state (verified, do not re-derive)

- Storybook is **not installed**. There is no viewer and no way to look at a
  component in isolation.
- `ui/src/catalog/` holds six hand-rolled story modules —
  `bullet`, `tag-chip`, `node-row`, `field-value`, `canvas-card`,
  `graph-toolbar` — plus `fixtures.ts` and `catalog.smoke.test.tsx`, which
  renders them in a test and asserts they do not throw.
- `ui/src/components/` has **79** `.tsx` files. So the catalog covers roughly
  8% of the surface, and nothing renders it for a human.

The owner asked directly: "Are we using storybook? if not please do add it."

## The Rule 1 constraint on this wave

The wrong outcome is Storybook installed *beside* the hand-rolled catalog, so
the repo has two story formats and contributors guess which to write. There
must be **one** mechanism for "a component rendered in isolation with fixture
props", and after this wave it is Storybook CSF.

That means the six existing modules get migrated to CSF3, not wrapped, not left
alone. And `catalog.smoke.test.tsx` must not become a second definition of the
same fixtures: rewrite it to import the CSF exports (Storybook's portable
stories / `composeStories`) so the test and the viewer read the same file. If a
story renders in the viewer, the test covers it, automatically. If that
integration is not workable, keeping the smoke test as-is is acceptable *only*
if it consumes the CSF files rather than a parallel fixture set — say which you
did and why.

## Part 1 — install and wire

Storybook 9 with the React + Vite builder, scoped to `tools/kb/ui`.

**Known integration risk, stated up front.** This UI does not use stock Vite.
`ui/package.json` pins `overrides.vite` to
`npm:@voidzero-dev/vite-plus-core@0.2.8`, and `vp` (vite-plus 0.2.8) owns dev,
build, test, and lint. Storybook's vite builder may or may not accept that
resolution. Determine this early — before writing 40 stories — and:

- If it works, wire it and note any version pinning required.
- If it does not, capture the exact failure, then try the documented escape
  hatches (explicit `viteFinal`, a Storybook-local vite resolution) **once**.
- If it still does not, **stop and report with the error output.** Do not fork
  the UI's build config to accommodate the viewer, and do not hand-roll a
  catalog page as a substitute — that is the parallel mechanism this wave
  exists to remove. A named gap plus the six CSF-migrated stories is a real,
  mergeable deliverable in that case.

Add a `storybook` script and a `build-storybook` script to `ui/package.json`.
Keep the story glob pointed at the catalog directory so stories live in one
place.

Wire the a11y addon if it is cheap; it is a real check, not decoration, given
this UI is keyboard-driven by design.

## Part 2 — coverage

Do not attempt all 79 components. Cover, in this order:

1. The six already in the catalog, migrated to CSF3 with named exports per
   meaningful state (not one story per component).
2. **`ui/src/components/outline/`** — this is the product. `node-content`,
   the field row and value stack (`fields-section.tsx` exports a pure
   `FieldValueStack` specifically so it can be rendered without a store),
   `tag-chip-group`, the bullet/collapse affordances, `editable-text`.
   Include the states that have actually regressed before: a tag pill next to
   one-line and multi-line content (pill is line-height and pushes back only
   the first line); a field with **two** values under **one** label; hover-only
   affordances in both states; read-only `sys.*` rendering.
3. Graph chrome — toolbar, legend, info chips, empty and error states — via
   the extracted `GraphCanvasFrame`.
4. Palette / command surfaces.

Prefer stories that pin a state someone previously got wrong. Typography and
the tag-pill geometry both have render specs already
(`ui/tests-render/typography.e2e.ts`) because they regressed; those are exactly
the states worth a story.

Where a component cannot be rendered without a live store or WS connection, do
not build a mock empire — note it as a gap and, if the fix is a small purity
refactor in your zone, do that instead (a pure presentational component with an
explicit-props boundary is the better abstraction and the reason `FieldValueStack`
was extracted in the first place).

## Zone

Yours: `tools/kb/ui/.storybook/**` (new), `tools/kb/ui/src/catalog/**`,
`tools/kb/ui/package.json`, and small purity refactors inside
`ui/src/components/**` needed to make a component storyable — keep those
minimal, behaviour-preserving, and listed.

Not yours: `tools/kb/package.json` (t1/g1), `src/**` backend,
`ui/src/api/ws.ts`, `ui/src/components/graph/force3d-three.ts`,
`ui/src/components/canvas/canvas-page.tsx` (g1 is removing `any` from those
three this wave — do not edit them).

## Acceptance

- `npm run storybook` (or the vp equivalent) serves a viewer that renders every
  committed story, or a documented, evidenced refusal per Part 1.
- Exactly one story format in the repo. No hand-rolled catalog module remains
  un-migrated, and the smoke test reads the CSF files rather than a second
  fixture set.
- Coverage tiers 1 and 2 complete; 3 and 4 as far as they get, with the
  remaining gap listed component by component.
- `build-storybook` succeeds (proves it is CI-able).
- Four-command verification green, counts reported. The UI suite must not
  regress from its 510 baseline.
