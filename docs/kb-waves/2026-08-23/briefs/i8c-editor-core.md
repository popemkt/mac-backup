# Brief i8c-editor-core — R9 Phase 2/3 remainder (tasks 13–17)

Harness: codex. Continues i8b, whose tasks 10–12 are ALREADY MERGED to main
(merge commit on main; `order.ts`, `tx-validation.ts`, MutationQueue in
`ui/src/actions/mutations.ts`, live `.kb/nodes.jsonl` already carries `order`
on all 187 nodes). Do not redo them. Protocol:
`docs/kb-waves/2026-08-23/briefs/impl-protocol.md`.

## Normative input

`docs/kb-waves/2026-08-23/reports/r9-editor-deep.md` §7 tasks **13–17**, plus
`reports/i8-editor-core.handoff.md` for Phase 1 context. Read
`reports/i8b-editor-core.handoff.md` if present.

Order: 13 CaretIntent → 14 FocusRegistry → 15 WS origin exclusion →
16 NodeTextHost consolidation → 17 spec reconciliation.

## Zone

`ui/src/components/outline/**`, `ui/src/stores/outline.store.ts`,
`ui/src/actions/**`, `ui/src/lib/{caret,md-edit,refs,selection-keymap}.ts`,
plus the sanctioned cross-zone touches task 15 requires:
`tools/kb/src/surface/ui.ts`, `tools/kb/src/surface/protocol.ts`.
Task 16 additionally reaches the table/board name cells and the zoomed-root
title (`ZoomedRootHeader.EditableTitle`) — that is in zone for this brief.
Task 17 edits `docs/kb-waves/2026-08-23/reports/r1-editor.md` and
`tools/kb/DESIGN-UI.md`.

Do NOT touch `components/graph/**` or `components/canvas/**` — a separate
graph wave (r10/i11) owns those concurrently. Conflicts there are expensive.

## Hard rules

- Each task = its own commit(s) with the named regression tests green.
- Task 15's wire change is additive (origin tag / skip-originator); old
  clients must keep working.
- Data compat additive-only; `.kb/nodes.jsonl` keeps loading; TODO content
  preserved.
- If a task conflicts with reality found mid-work, adapt and document the
  deviation in the handoff rather than forcing the report's letter.

## Verify (all four green before each commit)

```bash
cd tools/kb && bun install && bun test
npm run typecheck
npm run check
cd ui && ./node_modules/.bin/vp test
```

Baseline on main at dispatch: core 643 pass / 0 fail, typecheck clean, lint
clean, UI 433 pass / 0 fail. Any failure is yours. (The historical "50k
benchmark timing failure" and the `palette-index.test.ts` perf flake both pass
now that host disk pressure is resolved — if one reappears, it is a real
timing regression, not known noise.)

## Acceptance beyond suite

Caret: an offset captured before a split survives the split; a store write
that is not a caret intent never moves the caret. Focus: after any create the
new node is in `getVisibleNodes()` and exactly one `[contenteditable]` is
mounted; activating an unreachable target is refused, not silently dropped.
WS: the originating client receives no echo tx for its own action, and a
remote upsert onto a node with pending local edits merges rather than
clobbers. Text host: page title and table/board name cells share one host —
Shift+Enter works there, text survives a concurrent WS change, and line counts
are identical active vs inactive.

Handoff: `docs/kb-waves/2026-08-23/reports/i8c-editor-core.handoff.md`.
