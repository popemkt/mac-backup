# i10-polish — Implementation Handoff

**Wave:** i10-polish (owner typography / zero-shift / tags-as-nodes polish)
**Branch:** `popemkt/kb-i10-polish`
**Commits:**
- `9675cd1` feat(kb): adopt Inter Variable as default UI font (i10)
- `69cb4d9` fix(kb): eliminate tag chip and palette layout shifts (i10)
- `1bf3561` fix(kb): unify tag chip size onto one token path (i10)
- `786cce0` feat(kb): edit tag color via node-page field swatches (i10)
- `f00ffa5` fix(kb): polish NodeRow a11y and creation affordances (i10)

---

## Implementation handoff

### What shipped

#### 1. Typography — Inter Variable default
- Replaced `@fontsource/inter` static faces with `@fontsource-variable/inter`.
- Default `--app-font` is `"Inter Variable"` + metric-matched `"Inter Fallback"` (`size-adjust` / ascent / descent / line-gap). Outfit remains opt-in via prefs (`data-font="outfit"`).
- Preload latin wght subset from `main.tsx` (`?url` + `<link rel="preload">`); fontsource CSS already sets `font-display: swap`.
- Weight re-audit: body `--font-weight-body: 400`, field labels dropped `font-medium` → `font-normal`, tag weight via `--tag-weight`. Tokens expose `--kb-text-weight`.
- Prefs default + blocking `index.html` script default flipped to `inter`.

#### 2. Layout shifts eliminated
- `TagChip` remove × overlays the hash mark (`absolute inset-0` in a fixed `9×9` mark slot). Hover never changes measured chip width.
- Node command palette list slot always occupied (`min-h-[2.5rem]` + empty copy) so empty ↔ matched does not resize the shell.
- Field row remove already reserved width via opacity (regression-locked).
- Global command palette already fixed `w-full max-w-[520px]` (asserted; not edited — outside zone).
- Regression suite: `layout-shift.test.tsx` (chip / field row / both palettes).

#### 3. Tag size — one token, one path
- `--tag-size: 9px` / `--tag-line: 11px`; `--kb-chip` aliases through those vars.
- `.kb-chip, .kb-tag` share one rule block.
- Chip height `h-[12px]`. Proven: `node-content` only imports `TagChipGroup`; no hardcoded chip `text-[Npx]` in `tag-chip.tsx`.
- Hypothesis of a second striped path in `node-content` was already retired by i7 — confirmed, not reintroduced.

#### 4. Tag config = node page fields
- `SCHEMA_SURFACE_FIELDS` (`sys.f.color`, `sys.f.hidden`) are not intrinsic-hidden.
- Tag nodes get empty template slots from `sys.tag`’s `sys.f.fields` when unset.
- `ColorSwatchEditor` (palette + custom hex) routes via `fieldId === sys.f.color` in `PropValueEditor` / `EmptyTypedEditor`.
- `hidden` renders as checkbox. Palette icon on color `FieldRow`. No bespoke tag config panel.

#### 5. Standing polish
- `NodeRow`: `role="treeitem"`, roving `tabIndex`, Enter/Space (skips nested editors), focus-visible ring, active content ring.
- Create strips (`outline-editor` + `node-block`): `role="button"`, keyboard, focus-visible `+`.
- Query / outline loading: `aria-busy` / `aria-live` / status roles; schema empty `role="status"`.
- Node palette: Home/End + `role="dialog"`.
- Reduced-motion already global in `index.css` (unchanged).

### What was cut and why

| Item | Rationale |
|------|-----------|
| Live pixel CLS measurement in a real browser | No attached browser harness; structural + happy-dom/static markup regressions instead. |
| Edits inside `components/graph/**` or `components/canvas/**` | Zone ownership — concurrent waves. Flagged below. |
| Outline caret / `NodeTextHost` / editor focus internals | i8c owns those; left alone. |
| Global `command-palette.tsx` edits | Outside zone; already fixed-width — test-only assertion. |
| Ontology page’s local 11px chip | Outside zone; still a second chip path there. |

### Shared-file touches

| Path | Why |
|------|-----|
| `tools/kb/ui/package.json` (+ lock) | Add `@fontsource-variable/inter`; drop `@fontsource/inter`. |
| `tools/kb/ui/src/index.css` | Inter Variable import, fallback `@font-face`s, default `--app-font`, body weight tokens. |
| `tools/kb/ui/src/tokens.css` | `--kb-text-weight`, `--tag-*` 9/11, `.kb-chip`/`.kb-tag` unify. |
| `tools/kb/ui/index.html` | Prefs blocking script default font → `inter`. |
| `tools/kb/ui/src/main.tsx` | Latin Inter preload. |
| `tools/kb/ui/src/stores/prefs.store.ts` | Default font `inter`; parse treats unknown as inter, outfit opt-in. |
| `tools/kb/ui/src/components/prefs/preferences-popover.tsx` | Option order Inter first. |
| `tools/kb/ui/src/fixtures/graph.ts` | `sys.tag` carries color/hidden template fields (test realism). |

No edits to `App.tsx`, `ds/**` (DataScript), or `src/surface/ui.ts`.

### Follow-ups for later waves

| Item | Owner hint |
|------|------------|
| Graph header chips / legend hover still use opacity toggles that may shift in `components/graph/**` | r10 / i11 graph |
| Canvas card hover chrome (`opacity-0` overlays) | i8-canvas |
| Ontology page local chip (`text-[11px]`, separate from `TagChip`) | ontology polish |
| Visual CLS audit in a real browser (font swap + chip hover) | any QA pass |
| Board/table column width stability under filter toggles (light touch only here) | i5 / views |
| Roving tabindex sync when selection moves via outline keymap (ensure focused row tracks selection) | i8c / i5 |

### Verification

```
cd tools/kb && bun install && bun test   # 658 pass / 0 fail (final)
npm run typecheck                         # clean
npm run check                             # clean
cd ui && ./node_modules/.bin/vp test      # 448 pass / 0 fail
```

Core suite had intermittent timeouts on `ui-dev` / asset-server hooks under load; re-runs green — not caused by this wave. Did not push or merge.

### Self-grade vs Tana-level bar

**A− / “owner complaints landed; a few surfaces still outside the fence.”**

Inter + metric fallback + preload is the right font contract; chips no longer reflow on hover and read smaller via one token; tag colour is a normal field on the tag page. Honest gaps: no live visual CLS proof, graph/canvas/ontology chip leftovers recorded rather than fixed, and NodeRow roving tabindex still depends on selection state being updated by the existing keymap (not a full ARIA tree widget).
