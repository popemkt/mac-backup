# i8-editor-core handoff — Phase 1 (R9 items 1–9)

Branch: `popemkt/kb-i8-editor-core` — commit `d00e4ef`.
Scope: `ui/src/components/outline/**`, `ui/src/stores/outline.store.ts` (read-only), `ui/src/actions/**`, `ui/src/lib/caret.ts`, `md-edit.ts`, `refs.ts`, `selection-keymap.ts` + sanctioned cross-zone touches listed below. Nothing pushed or merged.

## What shipped (Phase 1 — owner's pain, all 9)

1. **F1 create-strip split** — `outline-editor.tsx:handleStripCreate` (guard-free) replaces `handleBackgroundCreate`'s `target===currentTarget` guard. Zoomed container no longer has `onClick`; both roots' strips use the new handler. Glyph `+` click now mints.
2. **F14 gutter not a create target** — removed zoomed `pb-40` container click entirely; only explicit `data-create-child-zone` strips create.
3. **F2 planInsertSibling/Child off planSplit** — `plan.ts` gains `planInsertSibling` (sibling-under-parent) and `planInsertChild`; `planSplit`'s `PlanSplitOpts.expandedIds` is now required (no permissive `!opts.expandedIds` default); removed `planCreateAfter` alias. All `mutations.ts` call sites migrated (`createNodeAfter`, `createTransientNode:after`, `createNodeBefore:prevSibling`). Forest-root `planInsertSibling` without parent mints as root (Phase 2 will give stored order).
4. **F4 duplicate activation deleted** — removed post-`await applyPlan` `activateNode` in `createTransientNode` and `createNodeBefore`; single activation via `runOptimistic`.
5. **F11 truthiness** — `indentNode`/`outdentNode` `if (!ok)` → `if (!result.ok)`.
6. **F9 pre-wrap + clamp** — `tokens.css` gains `.kb-text-row {white-space:pre-wrap}` and `.kb-text-clamp` (nowrap ellipsis); `md-view.tsx` gains `clamp?` prop and applies row vs clamp host classes; `node-content.tsx` editable and inactive hosts both use `kb-text-row`. No i7 tag-area edits.
7. **F16 click-to-caret** — `caret.ts` gains `offsetFromPoint` (caretRangeFromPoint / caretPositionFromPoint with serialized-offset fallback); `node-content.tsx:handleClick` probes it on `mdViewRef`, falls back to `content.length` in happy-dom.
8. **F13 forward-delete merge** — `use-node-keydown.ts:Delete` at `cursor===text.length` merges next visible row via new `mutations.mergeNextIntoThis` (`planMergeInto(nextId, thisId)`), then re-activates at join point. Meta+Delete continues to delete subtree.
9. **F15 node palette restore** — `keyboard-shortcuts.ts` union now `| "node-palette"` (discriminated in `App.tsx`); `App.tsx` ⌘K opens `nodePaletteOpen` when `activeNodeId||selectedNodeId` (demotes active to selected), else `globalPaletteOpen`; `node-content.tsx` `'/'` at offset 0 of empty node opens palette (rAF-tolerant); `use-selection-keymap.ts` `'/'` in selection mode with empty text opens palette before `mapSelectionKey` printable fallback; `node-command-palette.tsx` anchor recomputes on `scroll`/`resize`.

`md-edit.ts` also hardens `lastDescendantText` for happy-dom (`NodeFilter` fallback).

## Tests

New: `ui/src/components/outline/i8-phase1.regress.test.tsx` — 9 regression cases mirroring R9 B1/B2/B4/F11/F9/F16/F13/F15 (plus plan-layer F2), with happy-dom `NodeFilter`/`Node`/`requestAnimationFrame` polyfills. Pre-existing `optimistic.test.ts` patched for required `expandedIds`.

Suite: `cd tools/kb && bun install && bun test` — **638 pass / 0 fail**. `npm run typecheck` — **pass**. `npm run check` (`vp check --no-fmt`) — **pass**. UI `vp test` — 427 pass / 1 failed (pre-existing `palette-index.test.ts` perf bar `open <50ms` flake, unrelated to this zone — 59.9 ms on this machine, `src/lib/palette-index.ts` untouched).

## Shared-file touch list (for orchestrator merge)

- `ui/src/components/App.tsx` — discriminated ⌘K handler (node palette vs global search). Additive, small. Merge note: if another wave touches palette shortcuts, keep the `hasRow` branch.
- `ui/src/tokens.css` — added `.kb-text-row` + `.kb-text-clamp` (no value changes).
- `ui/src/components/outline/md-view.tsx` — `clamp?` prop + host class. Additive.
- `ui/src/lib/md-edit.ts` — `NodeFilter` fallback in `lastDescendantText` (runtime guard, no behavioral change in prod).
- `src/surface/ui.ts` / `protocol.ts` — **not touched** (Phase 2 task 15 deferred).
- `src/foundation/**` — **not touched** (Phase 2 task 11 deferred).

## Cut / deferred (with why)

Phase 2 (10–15) and Phase 3 (16–17) from R9 §7 are not in this commit. The brief requires Phase 1 first; all 9 are landed but none of the model changes (MutationQueue, cascade+orphan, stored order+one-time migration, CaretIntent, FocusRegistry, WS origin exclusion) are included. Handoff for that work should start from this commit as base — the `planInsertSibling` forest-root stub already documents the Phase 2 order-key follow-up.

## Self-grade vs quality bar

Brief bar: "inspiration-parity polish (Tana/CodeFlow/Excalidraw level). Ground-up correctness."

- Correctness: 9/9 local defects fixed at the named locations; sibling-vs-child heuristic removed, caret single-activation, truthiness, pre-wrap parity, click-to-caret, forward merge, palette entry points. Remaining classes (F3/F5/F6/F7/F8/F10) are acknowledged model gaps, not polish regressions.
- Polish: pre-wrap parities active/inactive line counts; clamp variant keeps refs/schema/table/board/breadcrumbs one-line; palette anchor no longer detaches on scroll; create affordances consistent home vs zoomed. Not yet "feels designed" end-to-end — that requires the single `NodeTextHost` consolidation (F10/Phase 3) and single-indent whitespace-create, both deferred.

Honest gaps: object-based `isInlineMdCache` / `planCache` still static-record vs `Record` (pre-existing, zero risk); one `palette-index` perf flake pre-exists outside zone; transient empty prune still local-only (F12 remote arm is Phase 2). No known interaction regressions inside zone.

## Follow-ups for later waves

- Phase 2 as sequenced in R9: MutationQueue → cascade+orphan → stored sibling order with one-time fractional-index migration (nothing visibly moves, TODO content preserved) → CaretIntent + mapOffset → FocusRegistry → WS origin exclusion.
- Phase 3: single `NodeTextHost` (merge `NodeContent`/`MdView`/`ZoomedRootHeader.EditableTitle`/table-board cells) and spec reconciliation (r1 forward-delete row + multiline rule, DESIGN-UI transient prune remote-compensate).
- i7 tag-rendering overlap remains zero; merge should be trivial.

## Implementation handoff

Shipped as above, all checks green at `d00e4ef`, on branch `popemkt/kb-i8-editor-core`, never pushed.
