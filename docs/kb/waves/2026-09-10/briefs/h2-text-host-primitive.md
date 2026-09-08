# h2-text-host-primitive — the node text editor is a primitive; surfaces bind it to their stores

Wave `h2` of `docs/kb/waves/2026-09-10/plan.md`. Harness: cursor (grok 4.6).
Branch `kb-h2-text-host` from `main`. Run `intent/gate.sh session cursor`
first; read `tools/kb/AGENTS.md` and the repo `CLAUDE.md` → "Rule 1" before
any edit. Read each gap node (`bun tools/kb/packages/app/cli/src/main.ts get
<id>`), then `tools/kb/harness/src/constraints.ts` → `UI_PRIMITIVES` and
`UI_ALLOWS` (the fence you are making pass **without adding rows**),
`components/outline/field-value.tsx` (line 526, one `useOutlineStore` call),
`components/outline/node-content.tsx` (396 lines; its store and action uses
are listed below), `components/canvas/canvas-card.tsx` (line 6, the breach),
`stores/ref-navigation.ts` (a hook that already lives in `stores/` and is
consumed by surfaces — the shape you will reuse), and
`docs/kb/waves/2026-09-09/reports/g2.md` → "Gap 10" (the last attempt at
this move and exactly why it was reverted).

You own: `components/outline/field-value.tsx`,
`components/outline/node-content.tsx` (which you will move), the new
`components/ui/node-text-host.tsx`, one new hook file under `stores/`, the
import line in each of the six files that import `NodeContent`
(`grep -rn "outline/node-content\|./node-content" packages/app/ui/src`),
`components/canvas/canvas-card.tsx`, their colocated tests, the baseline
**only** via `bun run harness:snapshot` when the `duplicates:` count drops,
your report. **Not yours**: `harness/src/constraints.ts` (if the move needs
a new `UI_ALLOWS` row, the move is wrong — stop and report),
`.oxlintrc.json`, `vite.config.ts`, `test-setup.ts`, `test-support/**`
(h1 owns those, in parallel), `actions/**`, any other store.

## The matrix, so you do not guess

From `UI_ALLOWS`: `primitives` may import `primitives` and `lib` only.
`lib` and `actions` may **not** import `stores`. `stores` may import
`stores`, `lib`, `api`, `session`, `ds` — **not** `actions`. Every surface
row (`components/outline`, `components/canvas`, …) may import `primitives`,
`stores`, `actions`, `lib`. Therefore:

- the primitive takes **everything** it needs as props;
- store-side wiring (reads and store actions) can be one hook in `stores/`;
- mutation callbacks (`mutations.*`) must be passed by the surface, because
  no shared zone may import both `stores` and `actions`.

## Gaps, in order

1. `01M1RXMRJA3ZRAWPTB0ZH5YEYG` — `field-value.tsx` subscribes to the outline
   store. The gap's `current` is stale: since g5 the only remaining use is
   `const zoomTo = useOutlineStore((s) => s.zoomTo)` at line 526, inside the
   ref-chip row. Lift it: the component receives an `onZoomTo(id)` callback
   (or the row's existing `onOpen` covers it — read the call sites and say
   which). The callers (`field-row.tsx`, `fields-section.tsx`,
   `board-cards-view.tsx`, `table-view.tsx` — all in `components/outline`,
   which may import stores) pass it. Remove the `// GAP` marker on line 18.
   There is no colocated `field-value.test.tsx`; the editor and outline
   suites that render it, and the two `field-value*.stories.tsx`, must pass
   unchanged except for the new prop.
2. `01M1RXNGSJT2J2VHDSYY7QJSD3` — canvas cards render outline's
   `NodeContent`. g2 measured the move at four breaches, all inside
   `node-content.tsx` itself: `@/actions/mutations` (line 3),
   `@/stores/outline.store` (14), `@/stores/ui.store` (15),
   `@/stores/ref-navigation` (16). The store uses are: `nodes`, `zoomTo`,
   `pendingCaret`, `getState()` for `consumeCaret` / `placeCaret` /
   `selectNode`, `useUiStore.getState().setNodePaletteOpen`,
   `useRefNavigation()`; the mutation uses are `attachFileToNode` and
   `removeTag`. Shape:
   - `components/ui/node-text-host.tsx` exports `NodeTextHost` and a
     `NodeTextHostBinding` type: the store reads and store actions above as
     plain values/functions, plus `onAttachFile(file)` and
     `onRemoveTag(tagId)`. No store import, no action import. Its existing
     `onChange` / `isActive` / `onActivate` props stay as they are.
   - `stores/node-text-host-binding.ts` exports
     `useNodeTextHostBinding(nodeId, instanceKey)` returning the store half of
     that type (it may import `outline.store`, `ui.store`, `ref-navigation`
     — all `stores`). One hook, used by every surface.
   - `components/outline/node-content.tsx` becomes ~20 lines: calls the hook,
     adds the two `mutations.*` callbacks, renders `NodeTextHost`. Keep the
     `NodeContent` name for the outline's importers so their five import
     lines do not change; **drop** the `NodeTextHost` alias export the
     baseline lists as a duplicate and take the snapshot.
   - `canvas-card.tsx` does the same binding itself (hook + its own two
     callbacks) and imports `NodeTextHost` from `@/components/ui/…`; the
     `// GAP` marker on line 6 comes off.
   Run `bun run harness` — `ui-boundaries` must show **zero** breaches from
   these files and zero new rows or markers anywhere. If any breach remains
   after this shape, **stop**: do not add a marker, do not add a row. Revert
   nothing; leave the branch at the last green commit, rewrite the gap's
   `current` to name the exact `file:line` left, and report.

Every gap you close: `status=done` via the CLI (`… prop unset <id> status …`
then `… prop set <id> status done` — props are multi-valued), `// GAP [[id]]`
markers off.

## Rules

- Behaviour-preserving. `bun run test:ui` passes unchanged through every
  commit, apart from adding the new prop in tests that construct
  `FieldValue` directly. A test that must change its assertion means the
  move changed behaviour — stop and look.
- Rule 1: one binding hook, one primitive. Not one hook per surface, not a
  `NodeContentForCanvas`. If canvas needs something outline does not, that
  difference is a **prop**, never an `if (surface === …)`.
- No `.skip`, no new `oxlint-disable`, no baseline edits except the snapshot
  when `duplicates:` drops. `complexity` and `max-lines-per-function` counts
  may not rise (the hook and the thin wrapper should make them fall).
- Never edit `.kb/nodes.jsonl` by hand; only through the CLI above. Never
  use the `kb` shim; always `bun tools/kb/packages/app/cli/src/main.ts`.

## Commits

1. `refactor(kb-ui): FieldValue takes onZoomTo; the primitive drops its store import`
2. `refactor(kb-ui): NodeTextHost is a primitive bound through useNodeTextHostBinding`
3. `refactor(kb-ui): canvas cards render the NodeTextHost primitive`
4. `chore(kb): close text-host gaps` — statuses, docs regenerated
   (`bun tools/kb/packages/app/cli/src/main.ts action-invoke
   '{"id":"docs.materialize","input":{}}'`).

Gates before each: `bun run verify`, `bun run test:ui`, `bun test packages`
(run in `tools/kb`). Commit in the background — pre-commit takes minutes.
If a UI suite outside your files reddens under load, rerun it alone once;
if it is green alone, note it (gap `01M1XA98A0A7PWEPMHG2T4R5GP`, h1 is on
it) and continue.

## Ownership answers

Files above: yes. A new hook in `stores/`: yes, one. `constraints.ts`: no.
`actions/**`: no. Anything else: smallest call, record it in the report,
continue.

## Report

`docs/kb/waves/2026-09-10/reports/h2.md`: per gap, closed or not and the
commit; the `NodeTextHostBinding` type as landed; the `ui-boundaries`
breach list before/after (exact `file:line`); `complexity` /
`max-lines-per-function` / `duplicates` counts before/after; the six
importers and what changed in each; test output; "Calls I made".
