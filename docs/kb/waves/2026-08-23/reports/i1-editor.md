# Implementation Report i1-editor — Outline editor: Tana-grade rebuild

**Worker:** opencode (wave I1)
**Branch:** `popemkt/kb-i1-editor` (commits `caf91d8`, `9a1807d`, `8fde50f`)
**Research input:** r1-editor.md (normative)

## Implementation handoff

### What shipped

All 20 defects from the r1 table are fixed or structurally eliminated, plus
the §3 interaction spec and the One-Row Metric Invariant.

- **D01–D04 (ghost rows): removed entirely.** `GhostNodeRow` is deleted with
  its async char-buffering and `beforeinput` interception. Tana transient
  semantics instead: `mutations.createTransientNode` mints a real node
  synchronously through the normal optimistic path, marks it
  session-transient, and activates it at offset 0. Whitespace click-strips
  (`data-create-child-zone`) at the end of every expanded container and at
  zoom-root level do click-to-create. Empty transients auto-prune when focus
  moves on (`pruneOutgoingTransient` in the store); pre-existing nodes are
  never pruned, so committed TODO content stays safe.
- **D05:** `mutations.indentNode` expands the new parent chain before caret
  restore; focus returns to the exact character offset (new `focusSeq`
  forces re-placement after the row remounts).
- **D06:** caret reads go through `getCaretSerializedOffset`
  (`lib/md-edit.ts`) — a recursive DOM measure that survives element
  boundaries and counts atomic pills at full token length.
- **D07:** `planSplit(..., {expandedIds})` inserts the new row as FIRST CHILD
  when the node has children and is expanded; sibling-after otherwise.
- **D08:** first-child Backspace-at-0 outdents with caret preserved; an empty
  leaf deletes with focus on the previous visible node end. Never swallowed.
- **D09:** `planMergeInto` merges onto an explicit visual predecessor;
  `mergeWithPrevious(id, instanceKey?)` resolves it through
  `getPreviousVisibleInstance` (cross-parent, deepest last descendant).
- **D10/D11:** `outline/caret.ts` adds range-rects line detection,
  the pure `verticalArrowDecision`, and `nearestOffsetForX` column
  restoration consumed through store `focusX`. Layout-free environments
  degrade to safe offset-based behavior.
- **D12:** Mode B completed: Tab / Shift+Tab, Cmd+Shift+Up/Down, Cmd+.,
  ArrowLeft/Right collapse/expand/parent/first-child, printable-char append,
  Shift+O create-above.
- **D13:** zoomed title is click-to-edit with header typography; sys roots
  stay read-only behind a padlock.
- **D14/D15:** autocomplete dismissal state — Escape closes the popup without
  blurring; a changed query reopens. Enter/Tab are intercepted whenever the
  popup is open regardless of candidate count (select a candidate, or close
  the bracket at zero). Splitting while the popup is open is impossible.
- **D16:** active-editor refs render as atomic `contenteditable=false` pills
  carrying the serialized token; serialization round-trips canonical
  markdown. Raw ULIDs never face the caret.
- **D17:** empty field values render zero DOM text with `.empty-placeholder`
  CSS placeholder (text/date/ref editors).
- **D18:** FieldRow remove button moved to the trailing right edge; value
  column x is invariant to action presence.
- **D19:** action-level undo/redo: pure `invertPlan`/`inversePlanActions`
  against pre-state, bounded store stacks of `{inv, actions}`,
  best-effort remote compensation posts in api mode, Cmd/Ctrl+Z binding
  outside editable targets. A redo-reconstruction bug was found by tests
  during this wave and fixed (opposite entry must be captured against
  PRE-application state).
- **D20:** sys.* guards fire upfront — `store.activateNode` degrades sys ids
  to selection so no caret enters them; NodeContent shows a hover padlock.

Spec §3.1 focus hand-offs (split→new at 0, indent/outdent→same offset,
merge→join boundary, delete→neighbor) are implemented and tested.

### Verification

All four protocol suites green at final commit:

- `cd tools/kb && bun install && bun test` — 483 tests, 0 fail
- `npm run typecheck` — clean
- `npm run check` — 0 warnings/lint errors
- `cd ui && ./node_modules/.bin/vp test` — 309 tests, 0 fail

Live boot acceptance: served a throwaway copy of `.kb/nodes.jsonl` from a
temp root (`kb ui --root /tmp/... --port 4399`) and drove the real app in a
browser. Repro results: zero ghost rows in DOM; D05 Tab-into-collapsed keeps
the row visible/focused with caret intact; D07 Enter on expanded parent lands
as focused first child; D08 Backspace outdents without swallowing; D14 Escape
dismisses popup while editing continues; D15 Enter cannot split with popup
open; D13 title edits in place with header type scale; D16 pill renders with
label only, no ULID exposure; Cmd+Z restores deleted/split/outdented rows;
click-to-create mounts an editor with caret ready and a fast
"hello-fast" burst landed with zero dropped characters.

### Shared-file touches

**None.** `App.tsx`, `index.css`, `tokens.css`, `ds/**`, and
`src/surface/ui.ts` are untouched; the diff is confined to the zone. Two
zone-boundary notes for the orchestrator:

1. `ui/src/lib/selection-keymap.ts` (+ test) — outside the letter of the
   zone list but D12 anchors at this exact file in the r1 table (verdict:
   EXPAND), so it was edited in place.
2. `ui/src/lib/md-edit.ts` (+ test) — NEW additive file backing
   `components/outline/caret.ts` and NodeContent (D06/D16). No existing file
   outside the zone imports it.

Stale entry: `tools/kb/bunfig.toml` still ignores the deleted
`ghost-node-row.component.test.tsx`; harmless (matches nothing), left for
the owner since bunfig sits outside this zone.

### What was cut, and why

- **Tag autocomplete (`#`) and command palette (`/`) triggers** from Mode A:
  distinct popovers with their own data sources; not in any D-row. The ref
  pipeline (`[[`) is the template for both — later wave.
- **Undo of prop-only edits and debounced text keystrokes:** text floods
  history by design; destructive structural ops are covered. Prop inverses
  are computable in `invertPlan` terms but need value-diff actions.
- **Column preservation across projected views (table/board rows):** focusX
  plumbing works within list outlines; projected row editors don't consume
  it yet.
- **Server-authoritative undo log:** compensation posts are best-effort;
  a durable undo journal belongs in core, not the UI projection.

### Follow-ups for later waves

1. Port TableView/BoardCardsView name cells onto the shared pill editor so
   refs stay atomic there too (they share `useNodeKeyDown` already).
2. Wire `focusX` consumption into query-result ref rows.
3. Tag/command autocompletes reusing the NodeContent dismissal pattern.
4. Consider pruning empty transients on Escape→select after a timeout.
5. Remove the stale bunfig ignore entry (owner: tools/kb).
6. `mutations.indentNode` computes siblings via wire parents; a store-level
   sibling helper would deduplicate the forest-root special case.

### Self-grade against the quality bar

**A−.** Honest gaps:

- The undo stack does not coalesce rapid same-node text edits, so mixing
  typing with Cmd+Z can surprise until the follow-ups land (structural ops —
  the D19 target — are solid).
- Column restoration depends on real layout metrics that unit tests can only
  exercise through injected geometry; the live-boot check compensates but a
  Playwright suite would make it regression-proof.
- Bracket-completion on zero candidates is deterministic but unannotated in
  the UI (no hint row) because RefAutocomplete sits outside the zone.
- Everything else: invariant-backed geometry, spec-complete keymaps,
  transient lifecycle, and the boot repro all behave as specified; commits
  are small, conventional, and each passed the full gate.
