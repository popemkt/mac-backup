# t4-favicon — kb gets a favicon

Wave `t4` of `docs/kb/waves/2026-09-04/plan.md`. Harness: omp. Branch from
`main`. Runs in parallel with `t1`/`t2`; you own only
`tools/kb/packages/ui/public/**` and the `<head>` of
`tools/kb/packages/ui/index.html`. Touch nothing else.
Run `intent/gate.sh session omp` first.

Read first: `tools/kb/DESIGN-RESKIN.md` (visual language: fonts, palette,
"everything is a node"), `tools/kb/packages/ui/index.html`,
`tools/kb/packages/ui/vite.config.ts` (confirm the default `public/` dir is
in effect — no `publicDir` override — so files land in `dist/` at the root and
the server's SPA fallback in `packages/server/src/assets.ts` serves them).

## Deliverable

- `packages/ui/public/favicon.svg`: a hand-written SVG, ≤ 1 KB, no raster, no
  external font. Motif: the outliner — a bullet with a child bullet, or a
  node-with-edges glyph; 2–3 shapes at most. Must read at 16 px. Use
  `currentColor`-free explicit fills with a `<style>` block containing
  `@media (prefers-color-scheme: dark)` so it inverts sensibly in dark tabs.
- `packages/ui/public/favicon.png` is **not** wanted; one SVG plus an
  `apple-touch-icon.png` (180×180) only if you can generate the PNG from the
  SVG locally without adding a dependency (e.g. `rsvg-convert`, `qlmanage`,
  `sips`); otherwise skip it and say so.
- `index.html` `<head>`: `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`
  (and the apple-touch line if you shipped the PNG). Nothing else changes.

## Acceptance

- `bun run --filter @kb/ui build` succeeds and `packages/ui/dist/favicon.svg`
  exists. `bun run verify` still green (no TS touched, so this is a formality —
  run it anyway).
- Show the SVG source in the report and a one-line description of the glyph
  at 16 px (what a viewer sees).
- Commit: `feat(kb-ui): add favicon`.

## Report

`docs/kb/waves/2026-09-04/reports/t4-favicon.md`.
