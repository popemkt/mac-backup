# g2-primitives — shared presentation moves into `components/ui/`; leaves stop reaching up

Wave `g2` (batch 2) of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude.
Branch `kb-g2-primitives` from **`kb-merge-origin`** (batch 1 merged: g1, g3,
g4, g6). Run `intent/gate.sh session claude` first. Read each gap node
(`bun tools/kb/packages/app/cli/src/main.ts get <id>`), then
`tools/kb/harness/src/constraints.ts` (`UI_ALLOWS`, `uiZoneOf`) and
`harness/tests/ui-boundaries.test.ts` — the fence you are making pass without
adding rows — and `docs/kb/waves/2026-09-09/reports/g3.md` → "Gap 7" (the
five-breach list your work is meant to dissolve).

You own: `tools/kb/packages/app/ui/src/components/ui/**` (additions),
the files you move out of `components/outline/`, `components/ontology/`,
`components/sidebar/`, `components/preferences/` and every importer of them,
`ui/src/api/graph.ts`, `ui/src/lib/toast.ts`, `ui/src/lib/canvas-api.ts`, the
two outline components that run DataScript directly, the component that owns
the live-query subscription, `ui/src/stores/ui.store.ts` (toast surface only).
**Not yours**: `harness/src/constraints.ts` (no new `UI_ALLOWS` rows — if a
move needs one, the move is wrong; stop that gap and report), `.oxlintrc.json`,
the baseline (except `bun run harness:snapshot` when a count *drops*),
`components/outline/{field-row,prop-value-editor,ref-editor,bullet,node-block}*`
(g5's zone, running in parallel — coordinate by not touching them; if a move
forces an import rewrite in one of them, make it the one-line import change
and list it in the report).

## Gaps, in order

1. `01M1RXNKKK31EGJWCA1KCV6V20` — ontology member rows render outline's
   `MdView`. Move `md-view` into `components/ui/`; it takes text and options
   and touches no store. Rewire importers (outline, ontology, anything else).
2. **`caret.ts` promotion** — file a `#gap` first (the k1-style `kb add … --tag
   gap` line from `CLAUDE.md`; `expected`: caret helpers are a primitive,
   `current`: `components/outline/caret.ts` imported by `NodeTextHost` and the
   editing keymap, `impact`: blocks gap 7, `closes`: move to `components/ui/`
   or `lib/`), then close it: `caret.ts` has no store dependency, so it goes to
   `lib/` if it is pure DOM math, `components/ui/` if it renders. Note g4's
   `components/outline/editing-keymap.ts` imports `VerticalNavDecision` from
   `./caret` — that import moves with it.
3. `01M1RXNHJ8S019678AYDKWYE63` — GraphPage embeds `OntologyPicker`. The gap
   offers two closes; pick **App passes the chosen ontology down as it already
   passes the perspective** unless the picker is genuinely a primitive (no
   store, no ontology-surface imports). Say which and why.
4. `01M1RXNJHCH2Q5HCKQNEKVQGKD` — GraphPage imports the sidebar's toggle
   button. `SidebarToggle` → `components/ui/`.
5. `01M1RXNMP8NQZ2WD8F2E8V6QBH` — preferences popover renders outline's
   `PrefFieldRow`. Row layout → `components/ui/` beside `EnumSelect` and
   `PopoverShell`.
6. `01M1RXMR501MC0KQ85WSNHC97R` — production `api/graph.ts` imports the graph
   test fixture. Decide: move the fallback snapshot into a production module
   beside `api/`, or drop the fixture fallback and let the caller decide what
   an unreachable server means. Prefer the second if nothing in production
   relies on the fixture's content; check `git log -S` for why it exists.
7. `01M1RXMRZKE1AJC850BRTHHHCW` — two outline components run DataScript
   through `ds/` directly. Move both queries behind a `lib/` or store selector
   the components consume.
8. `01M1RXMS5Z0A5H46MF63Q9AAPM` — an outline component owns the live-query
   subscription. Fold it into the query-node store slice or a `lib/` hook
   returning results; component gets props. Pairs with 7.
9. `01M1RXMQPVJKREGDS7D37J1MWN` — the two remaining thirds (g4 closed
   `run-command`): `lib/toast.ts` → toast moves onto `ui.store`'s own surface;
   `lib/canvas-api.ts` → takes the node map, not the store type. Close the
   gap when both are done.
10. `01M1RXNGSJT2J2VHDSYY7QJSD3` — canvas cards render outline's `NodeContent`
    (g3's blocked gap 7). After 1 and 2, re-run g3's experiment: `git mv`
    `node-content.tsx` → `components/ui/node-text-host.tsx`, rewire six
    importers, drop the `NodeContent` alias (the baseline's `duplicates:` entry
    goes with it — snapshot), run `ui-boundaries`. If the only breaches left
    are `primitives -> stores` / `-> actions`, **stop**: those are gap
    `01M1RXMRJA3ZRAWPTB0ZH5YEYG` (field-value subscribes to the store, "lands
    with the outline-store split"). Revert the move, leave gap 10 open, and
    rewrite its `current` to name exactly the remaining breaches. Do not add a
    row to make it pass.

Every gap you close: `status=done` via the CLI, `// GAP [[id]]` markers off.

## Rules

- Moves are behaviour-preserving; the UI suite (`bun run test:ui`) passes
  unchanged through every move commit. A move that needs a test edited is a
  move that changed behaviour — stop and look.
- `ui-boundaries` must pass after every commit with **zero** new rows and
  zero new `// GAP [[…]]` markers.
- No `.skip`, no new `oxlint-disable`.

## Commits

One per gap or per coherent pair (1+2, 7+8), `refactor(kb-ui): …`; the caret
gap's `kb add` and its closure may sit in the same commit as the move. Last
commit `chore(kb): close primitive gaps` with statuses and regenerated docs.
Gates before each: `bun run verify`, `bun run test:ui`, `bun test packages`.
Background commits.

## Ownership answers

Files above: yes. A one-line import rewrite in a g5 file: yes, list it.
`constraints.ts`: no. Anything else: smallest call, record, continue.

## Report

`docs/kb/waves/2026-09-09/reports/g2.md`: per gap, closed or not and the
commit; the `ui-boundaries` breach count before/after; what gap 10's
remaining breaches are (exact file:line); which g5 files you touched, if any;
test output; "Calls I made".
