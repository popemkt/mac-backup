# Brief i8-editor-core — Creation/editing ground-up rebuild (r9 execution)

Harness: omp. Zone: `ui/src/components/outline/**`,
`ui/src/stores/outline.store.ts`, `ui/src/actions/**`, `ui/src/lib/caret.ts`,
`md-edit.ts`, `refs.ts`, `selection-keymap.ts`, plus TWO explicitly-sanctioned
cross-zone touches (list them in handoff):
- `src/surface/ui.ts` + `protocol.ts` for WS origin exclusion (task 15)
- core tx validation for cascade delete (task 11) in `src/foundation/**`
Protocol: `docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

## Normative input

`docs/kb/waves/2026-08-23/reports/r9-editor-deep.md` — execute its §7 task
list in order. Phase 1 (items 1–9) is the owner's pain — land ALL of it first:
create-strip/background handler split, whitespace-create consistency,
planInsertSibling/Child off planSplit, single activation (delete post-await
activate), `if (!result.ok)` fix, inactive multiline pre-wrap + explicit clamp
variant, click-to-caret at x, forward-delete merge, node command palette
restore (⌘K discriminated + `/` at offset 0). Each carries its named
regression test — write the tests.

Phase 2 (10–15): MutationQueue per-node FIFO ordering, cascade delete +
orphan rejection, stored sibling order with one-time order-key migration
(nothing visibly moves; `.kb/nodes.jsonl` additive only), CaretIntent
one-shot model, FocusRegistry validated activation, WS origin exclusion.
Phase 3 (16–17): single NodeTextHost consolidation + spec reconciliation in
r1 report and DESIGN-UI.md.

## Hard rules

- Every fix ships with its regression test; suite stays green at each commit.
- Multiline semantics: active == inactive line count in normal outline rows;
  compressed contexts (refs/schema/table/board/breadcrumbs) clamp explicitly.
- Sibling-order migration: one-time assignment preserving current visible
  order; additive fields only; TODO content preserved.
- The i7 wave may touch tag rendering in node-content.tsx concurrently —
  keep your tag-area edits to zero if possible; overlap resolves at merge.

## Acceptance beyond suite

Boot the app: rapid create-type-create-type cycles never lose focus or drop
characters; clicking + inserts exactly there; delete always works including
with children (cascade); multiline renders identical focused/unfocused; `/`
opens node palette in an empty node; ⌘K opens node palette when a row is
selected, global search otherwise; cursor never jumps during typing.
Handoff: `docs/kb/waves/2026-08-23/reports/i8-editor-core.handoff.md` with
per-phase completion + shared-file touch list + honest self-grade.
