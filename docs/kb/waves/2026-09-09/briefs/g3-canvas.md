# g3-canvas — two pointer bugs, the keydown split, edge rewiring into the action layer, and the card's content primitive

Wave `g3` of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude. Branch
`kb-g3-canvas` from **`kb-merge-origin`**. Run `intent/gate.sh session claude`
first. Read `docs/kb/waves/2026-09-07/reports/u2.md` (the canvas split that
produced `lib/canvas-pointer.ts`, `use-canvas-doc.ts` and the characterization
test) and `docs/kb/waves/2026-09-07/briefs/u2-canvas-split.md`; then each gap
node below (`bun tools/kb/packages/app/cli/src/main.ts get <id>`).

You own: `tools/kb/packages/app/ui/src/components/canvas/**`,
`tools/kb/packages/app/ui/src/lib/canvas-*.ts` and their tests, the canvas
action layer, and — for gap 7 only — moving `NodeContent` (or its read-only
part) from `components/outline/` into `components/ui/` with its importers
rewired. `harness/src/constraints.ts` is **not** yours: if the move needs a new
row in `UI_ALLOWS`, stop at that commit, report it, and continue with the rest.
Known red you do not touch: `packages/domain/model/tests/kinds.test.ts` (3
fails, owned by g1).

## Gaps, in order

1. `01M1TAE8HKYARYNTAVNMP566GV` — move release persists the unsnapped
   position. Fix in the pure reducer (`finishMove` reuses the snap the
   pointer/move path already computes); reducer test: snap on move, assert
   the doc after pointer/end.
2. `01M1TAE8V1GDX971M2A6NC4DS1` — Shift-locked resize from nw/sw/ne moves the
   anchored corner. Recompute x/y after the ratio lock from final w/h;
   reducer test with `shiftKey` for each of the four handles.
3. `01M1MGCSQY0M708HYYTWHP0XP2` and 4. `01M1MGCT80E1FMXMEAEATS1VER` —
   onPointerMove / onPointerUp drag state machine. u2 may already have closed
   these by extracting `canvas-pointer.ts`. **Verify against the current
   code**, not the gap text: if the handler is now event plumbing over one
   reducer, mark both gaps `status=done` (the way k1 and c1 did it) with a
   one-line note of what closed them; if branches remain in the component,
   finish the extraction.
5. `01M1MGCS6A29HT51G40W5TEEYK` — the canvas keydown effect (66 branches).
   Same treatment u2 gave the pointer: a pure `mapCanvasKey(chord, state) →
   intent` and an applier, mirroring `selection-keymap`. Clipboard already has
   `parseCanvasDoc` to lean on. Characterization first: record the current
   chord → effect table as a test before you move anything.
6. `01M1MGCTRFEHBF15DSCNDXW0GZ` — `onModeChange` rewrites edge links inline
   (22 branches). Move it beside the other canvas mutations in the action
   layer; the component calls one function.
7. `01M1RXNGSJT2J2VHDSYY7QJSD3` — canvas cards render outline's
   `NodeContent`. Promote the read-only part the card needs into
   `components/ui/`; leave the editing half in outline. The
   `// GAP [[01M1RXNGSJT2J2VHDSYY7QJSD3]]` marker comes off the import when
   the fence passes.

Every gap you close: `status=done` on the node via the CLI, and delete its
`// GAP [[id]]` marker(s) in code. Every gap you cannot close: leave it, say
why.

## Rules

- `eslint/max-lines` is `error` at 900 and `complexity` is a real lint gate;
  do not reintroduce a function the lint would have flagged before u2.
- Behaviour-preserving moves and behaviour-changing fixes are separate
  commits; the u2 characterization test must pass unchanged through every
  move commit and change only in the two bug-fix commits, where the change
  is the assertion of the corrected behaviour.
- No `.skip`, no new `oxlint-disable`, no baseline edits.

## Commits

1. `fix(kb-ui): canvas move release snaps; shift-locked resize keeps its anchor`
2. `refactor(kb-ui): canvas keydown is a pure chord map and an applier`
3. `refactor(kb-ui): edge relinking on mode change lives in the canvas action layer`
4. `refactor(kb-ui): NodeContent's read-only view is a primitive`
5. `chore(kb): close canvas gaps` — statuses + regenerated docs.

Gates before each commit, from `tools/kb`: `bun run verify`, `bun run
test:ui`, `bun test packages` (only the 3 known `kinds.test.ts` fails allowed).
Commit in the background and wait.

## Ownership answers

Canvas files and their tests: yes. Moving one file out of `components/outline/`:
yes. `constraints.ts`, `.oxlintrc.json`, baseline: no — report instead.
Anything else: smallest call, record it, continue.

## Report

`docs/kb/waves/2026-09-09/reports/g3.md`: per gap, closed or not and the
commit; the chord table you characterized; the two bug fixes' before/after
assertions; test output; "Calls I made"; anything left for the coordinator
(a `UI_ALLOWS` row, for instance).
