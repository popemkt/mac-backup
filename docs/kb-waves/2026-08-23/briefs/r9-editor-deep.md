# Brief r9 — Editor core: creation/editing bugs deep-study + ground-up spec

Agent: claude. Research only — NO implementation, NO commits.

## Mission

After wave i1 (Tana-grade rebuild, transient empty nodes), the owner still
reports the creation/editing path is buggy:

1. After adding several items via the +/create affordance, clicking sometimes
   stops working entirely.
2. Clicking the + sometimes inserts at the START (or wrong spot) instead of
   at the plus's position.
3. Delete sometimes doesn't work.
4. Cursor jumps while typing in creation flows (debounce suspicion).
5. Question: does multiline node content collapse when unfocused? If yes, is
   that the markdown/rendering approach? Decide what correct behavior is.

Study how mature OSS outliners handle these cleanly (Logseq is on GitHub;
also consider editor-component layers like ProseMirror/TipTap/Slate patterns)
and produce a ground-up, component-level design that is bulletproof.

## Read first

- `tools/kb/ui/src/components/outline/**` post-i1 (node-block, node-content,
  outline-editor, caret.ts, md-edit.ts, use-node-keydown, selection keymap,
  fields-section, ghost-related remnants)
- `tools/kb/ui/src/actions/{plan,mutations}.ts`, `stores/outline.store.ts`
- `.research/kb-refine/tana/report.md` (UX bar)
- Live repro via `bun tools/kb/src/surface/cli.ts ui`

## Do

1. Reproduce each reported bug with exact steps; root-cause at file:line with
   confidence level. Treat the optimistic/debounced mutation path as prime
   suspect for cursor jumps and creation races; treat event-targeting/focus
   management as prime suspect for click failures and wrong insert position.
2. Answer the multiline-collapse question definitively from code + live DOM
   (which element/CSS decides; what happens to \n when inactive; what SHOULD
   happen per Tana/Logseq).
3. Inline command palette: verify whether the nxus-style "select line → open
   palette scoped to that node" still exists post-refactor (see
   `node-command-palette.tsx`, selection-mode keymaps). State: exists /
   degraded / lost; if degraded/lost, spec the restore.
4. Component-level design proposal: the minimal set of editing primitives
   (caret, content host, creation transaction, deletion transaction) with
   invariants stated; identify which existing components violate SRP or hold
   split state that causes these classes of bug. Prefer fixing our model
   cleanly over bolting on; name anything we should import from OSS practice
   vs implement ourselves.
5. Classify every finding by fix class: local / abstraction replace / model
   change.

## Deliverable

`docs/kb-waves/2026-08-23/reports/r9-editor-deep.md`: repro table / root
causes / multiline verdict / palette verdict / component design spec with
invariants / i8 implementation task list (ordered, each item independently
testable).

## Constraints

- `./intent/gate.sh session claude` first.
- No tracked-file changes except your report; no commits.
