# Brief i8b-editor-core — R9 Phase 2/3: model changes

Harness: omp. Zone: same as i8 (`ui/src/components/outline/**`,
`stores/outline.store.ts`, `actions/**`, `lib/{caret,md-edit,refs,
selection-keymap}.ts`) plus the sanctioned cross-zone touches for tasks 11/15:
`src/surface/ui.ts`, `src/surface/protocol.ts` (WS origin), core tx validation
in `src/foundation/**` (cascade/orphan). Protocol:
`docs/kb/waves/2026-08-23/briefs/impl-protocol.md`.

## Normative input

`docs/kb/waves/2026-08-23/reports/r9-editor-deep.md` §7 tasks **10–17**, on
top of main which already has Phase 1 (commit f4be198 lineage). Read i8's
handoff first (`reports/i8-editor-core.handoff.md`) — it documents the
forest-root stub awaiting your order keys and the required `expandedIds`
change you build upon.

Order per report: 10 MutationQueue → 11 cascade delete + orphan rejection →
12 stored sibling order (+ one-time migration, nothing visibly moves) → 13
CaretIntent → 14 FocusRegistry → 15 WS origin exclusion → 16 NodeTextHost
consolidation → 17 spec reconciliation (r1 report + DESIGN-UI.md).

## Hard rules

- Each task = its own commit(s) with the named regression tests green.
- Migration additive-only; existing `.kb/nodes.jsonl` loads unchanged; TODO
  content preserved; one-time order-key assignment must not visibly reorder.
- Wire API stays backward compatible except where task 15's origin-tagging
  requires it (additive field, old clients unaffected).
- If you find a Phase 2 item conflicts with reality discovered mid-work,
  adapt and document in handoff rather than forcing the letter of the report.
- Side quest while suites run: `palette-index.test.ts` has a flaky perf bar
  (open <50ms, hit 59.9ms once) — if the fix is inside your zone or a trivial
  threshold/index improvement, take it; otherwise note it.

## Acceptance beyond suite

Rapid create-type-delete cycles under simulated latency stay consistent;
deleting a parent never leaves orphans at any layer; move/insert-at-root
reorders visibly; concurrent self-echo never clobbers local pending edits;
page title and table cells share the one text host (Shift+Enter works there).
Handoff: `docs/kb/waves/2026-08-23/reports/i8b-editor-core.handoff.md`.
