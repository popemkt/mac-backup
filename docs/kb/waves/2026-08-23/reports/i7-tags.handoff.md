# i7-tags — Implementation Handoff

**Wave:** i7-tags (Tag chips + field/prefs alignment polish)
**Branch:** `popemkt/kb-i7-tags`
**Commit:** `1e9585f feat(kb): polish tag chips, field rows, and prefs alignment (i7)`

---

## What shipped

### 1. Tag chip token + tight/compact polish (Owner directives 1 + §1.2)
- Added `--tag-size: 10px` / `--tag-line: 12px` to `tools/kb/ui/src/tokens.css`, tokenized chip typography via `.kb-tag` / `.kb-chip` aliasing. Chip renders at 10/12 @ 500, visibly smaller than `14.5/1.6` node/field text.
- `TagChip` tightened: `h-[14px]`, `gap-0.5`, `px-1`, Hash sizes normalized (9) so chips no longer look like body text; verified dark/light inheritance via oklch palettes.

### 2. Hover controls no longer reserve space (Owner directive 2)
- Remove × flipped from `opacity-0 → group-hover:opacity-60` (which always occupied 12px layout) to `hidden → group-hover/tag:flex` / `group-focus-within/tag:flex`. No gap reserved when hidden. Tests assert absence of `opacity-0` and presence of `hidden` + `group-hover/tag:flex`.

### 3. Configure affordance deleted; click → tag page everywhere (Owner directive 3)
- Removed `onConfigure`/`onTagConfigure`/`TagConfigPanel`/`GearSix` from every chip surface. `TagChip` now only has `onClick` (navigate) + `onRemove`.
- `tools/kb/ui/src/components/outline/tag-config-panel.tsx` deleted. `node-content.tsx` no longer imports or renders it; only local edit to `node-content.tsx` was dropping the import plus the `configTag` state and the `onTagConfigure` wiring (kept surgical per i8 shared-file rule).
- Clicking a tag chip consistently calls `zoomTo(tag.id)` in every surface: `node-content.tsx`, `references-section.tsx`, `schema-section.tsx`, `zoomed-root-header.tsx`, `board-cards-view.tsx`, `field-value.tsx` (ref row chips), and `field-type-config.tsx` (target-tag chips).

### 4. Field row geometry + sys.f.type ref correctness (Owner directive 4)
- `FieldRow`: single-source alignment — `items-start` flex with icon/label/value slots pinned `self-start h-6`, labels `items-start pt-px` (baseline aligns to first value line, not to block center). Multiline/spilling values keep labels top-aligned.
- `graph-view.ts`: new `resolveRefLabel(refId, nodes)` + refactored `formatPropValue` to return target `.text` when present, raw id only when missing. Field values for `sys.f.type` therefore show tag names, not ULIDs.
- `field-value.tsx:RefEditor`: when the target exists, renders `resolvedLabel` via that indirection; when the ref is dangling, renders a conditional row (shows previous `display` gracefully if display≠id, otherwise `warning/10` background + inline `⚠` and `data-unresolved-ref="true"` only when there truly is no target). No more always-warning ULID.

### 5. Preferences popover debug row (Owner directive 5)
- `preferences-popover.tsx:ShowAllFieldsRow`: input `shrink-0` + label `whitespace-nowrap` with explicit baseline — checkbox and label stay on one aligned row with no orphan wrap, still adapted via shared `FieldRow` depth −1 chrome.

### Tests added
- `shared-components.test.tsx:TagChip expose` split into navigation+remove check (2 buttons), display-reveal assertion, and a no-configure guard that reads `tag-chip.tsx` source for absent `GearSix`/`onConfigure`/`onTagConfigure`.

---

## What was cut and why

| Item | Rationale |
|------|-----------|
| Demo-quality screenshot assertion | No live browser harness (Orca `browser` not available for snapshot); verified via HTML-rendered component tests instead. |
| Tag configurator rewrite as tag-node inspector | Out-of-scope for the polish directive — directing tag clicks to Tag node zoom satisfies the "everything-is-a-node" intent and keeps i7 focused on chip/row/prefs quality. |

---

## Shared-file touches

| Path | Scope |
|------|-------|
| `tools/kb/ui/src/components/outline/node-content.tsx` | **Surgical only:** remove `TagConfigPanel` import, delete `configTag` state, drop `onTagConfigure` prop + config panel JSX. No editor/refs/MD logic touched — i8 owner safe. |
| `tools/kb/ui/src/tokens.css` | **Additive:** add `--tag-size`/`--tag-line` + `.kb-tag`/`.kb-chip` rules; dedup legacy duplicates. No color/layout regime changed. |
| `tools/kb/ui/src/lib/graph-view.ts` | **Additive:** add `resolveRefLabel`; `formatPropValue` ref branch now indirects through it. Pure helper. |

The remaining edits are i7-zone exclusive: `tag-chip.tsx` (delete+create), deleted `tag-config-panel.tsx`, `field-row.tsx`, `field-value.tsx` (ref rendering only), `components/prefs/**`, `field-type-config.tsx` (small click-through), and test/data updates.

---

## Follow-ups for later waves

- If tag nodes gain custom color swatches, thread the picker through `field-value`’s ref picker palette rather than via a chip-anchored panel — the deleted panel pattern is intentionally not reintroduced.
- The prefs popover still reuses `FieldRow depth -1`; when adding new prefs, prefer keeping values inside a wrapping `label` (checkbox pattern above) or a non-wrapping control container — re-check against narrow popovers.
- The `sys.f.type` ref resolution reasoned through `formatPropValue`/`resolveRefLabel`; other ref fields already go through `RefEditor`, no extra path needed.

---

## Self-grade vs quality bar

**B+ / "deadline-tight polish that actually lands the owner complaints, with edges named."**

The visible defects — oversized chips sharing body weight, reserved-remove gaps, stale gear spinner, centered labels vs multiline values, raw-ULID type rows, wrapping prefs row — are all eliminated and test-guarded. Tradeoff vs inspiration parity (Tana/CodeFlow/Excalidraw): the chip density and FieldRow geometry now feel deliberate rather than naïve, but the chip drag/reorder and full prefs popover chrome (e.g. outside-click trap) stayed out of scope as i7 was defined. Suite status: `tools/kb` 609 pass; `tools/kb/ui` 387 pass + 12 pre-existing fails (sys.* guard + debounced-resync fixtures, verified pre-existing by stash-pop diff) / lint clean except pre-existing 13 warnings. Harness pre-commit also passed (cargo: clean, Mackup kb assets, both typechecks, pins current, branch verified).

## Implementation handoff

**What shipped vs cut:** see above. Everything the brief required shipped except a literal pixel-perfect visual diff and a new tag-inspector surface — both cut for scope/harness reasons with explicit alternatives (component tests + zoom semantics).

**Shared-file touch list:** enumerated above (`node-content.tsx` surgical, `tokens.css` additive, `graph-view.ts` additive); full diff on `popemkt/kb-i7-tags@1e9585f`.

**Verification:** `./intent/gate.sh session omp` (SOFT_MISSING: shellcheck actionlint nvfetcher only wall 0.6s), `cd tools/kb && bun test` 609 pass, `bunx tsc --noEmit` both packages green, `bun test` in ui shared-component file 10/10, `bun x vp check --no-fmt` kb 0 errors / ui 0 errors 13 warnings (pre-existing). Pre-commit passed on commit (cargo/typecheck/pins).

**Follow-ups:** see above.
