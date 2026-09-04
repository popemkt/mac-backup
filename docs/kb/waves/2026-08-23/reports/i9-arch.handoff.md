# i9-arch handoff — Component architecture

## Implementation handoff

### What shipped

1. **`tools/kb/ui/ARCHITECTURE.md`** — component tree map, import/ownership
   rules, error-isolation table, God-component list with future split plans,
   catalog decision, production-readiness notes.
2. **Error boundaries** — Outline and Sidebar now wrap in `ViewErrorBoundary`
   so a render crash in either cannot blank the whole app (graph/canvas/
   ontology were already isolated). Regression asserted in
   `catalog.smoke.test.tsx`.
3. **Lightweight catalog** — `tools/kb/ui/src/catalog/*.stories.tsx` for
   TagChip, Bullet, NodeRow, PropValueEditor (FieldValue), TextCard (canvas
   card), GraphToolbar (2–4 variants each) + `catalog.smoke.test.tsx`
   (`vp`-friendly static render).
4. **Production-readiness (shell only)** — toast region `aria-live="polite"` +
   dismiss `aria-label`; documented remaining a11y gaps for surface owners.

### Catalog decision (judgment)

**Rejected Storybook / Ladle / Histoire.** kb UI already runs on `vite-plus`
(`vp`); a second Vite app, large lockfile surface, and CI storybook build are
not justified for six primitives that already have colocated behavioral tests.
**Rejected in-app `/__catalog` route** for this wave to avoid more shared
router/App churn. **Adopted** colocated story modules + smoke tests; a visual
catalog route can land later without changing the story modules.

### Cut / not done

- No God-component splits (zone: outline/graph/canvas internals read-only;
  pure-move only would not fix multi-responsibility files).
- No `KbNodeCard` stories (store-coupled); catalog uses presentational
  `TextCard` and notes KbNodeCard coverage via canvas tests.
- No deep a11y rewrites inside outline/graph/canvas (NodeRow click-div role,
  TextCard port labels, graph search dismiss label) — documented for i5/i7/i8.

### Shared-file touches

| Path | Why |
|---|---|
| `tools/kb/ui/src/components/App.tsx` | Wrap Outline + Sidebar in `ViewErrorBoundary`; toast a11y (`aria-live`, dismiss label); subscribe `rootNodeId` for outline `resetKey` |

No edits to `index.css`, `tokens.css`, `ds/**`, or `src/surface/ui.ts`.

### Follow-ups (later waves)

| Item | Owner hint |
|---|---|
| Split `canvas-page.tsx` (~1859 LOC) into shell / tools / selection / render | i8-canvas |
| Split `field-value.tsx` by field type | i7-editor / i5 |
| Split `sigma-graph.tsx` host vs events vs style | i2/i8-graph |
| Extract App route switcher; keep App as chrome composer | i5 / any shell pass |
| NodeRow: `role` / keyboard for clickable row shell | i7 / i5 |
| TextCard ports + resize handle aria-labels | i8 |
| Optional `/__catalog` dev route consuming `src/catalog` stories | future DX |

### God components (quick list)

See `ARCHITECTURE.md` table. Top offenders: `canvas-page.tsx` (1859),
`sigma-graph.tsx` (540), `ontology-page.tsx` (532), `field-value.tsx` (481),
`table-view.tsx` (473), `board-cards-view.tsx` (418), `App.tsx` (410),
`outline.store.ts` (743).

### Verification

- `bun install` + `bun test src` (core): green
- `tools/kb` `npm run typecheck` + `npm run check`: green
- UI: `npm install --force` (shell has npm 10.9.8; package wants 12.0.2 —
  pre-existing engine mismatch, same as r7 note), then
  `./node_modules/.bin/tsc --noEmit` green,
  `./node_modules/.bin/vp test` **62 files / 419 tests** green (includes
  catalog smoke; one intermittent keymap timing assertion outside zone
  failed once then passed on re-run), `vp check --no-fmt` 0 errors
  (pre-existing warnings outside zone in graph/mutations).
- Did not push or merge.

### Judgment calls

1. Catalog = colocated stories + smoke tests, not Storybook/Ladle/in-app route.
2. Canvas catalog subject = `TextCard` (presentational); `KbNodeCard` left to
   canvas tests.
3. Boundaries only in App (outline + sidebar); no new boundary component type.
4. Surface a11y gaps documented, not patched inside read-only zones.
5. God-component splits deferred to owning waves (plans in ARCHITECTURE.md).

### Self-grade

**A−** — Mission delivered: audit + conventions doc, missing boundaries,
catalog decision with minimal implementable catalog, honest God-list for
future waves. Gaps: no visual catalog UI, no structural refactors of Gods
(by zone design), surface a11y left as findings.

