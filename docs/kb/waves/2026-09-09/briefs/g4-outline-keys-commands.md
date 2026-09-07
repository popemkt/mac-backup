# g4-outline-keys-commands — keys map to intents through tables; commands live in one registry

Wave `g4` of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude. Branch
`kb-g4-outline-keys` from **`kb-merge-origin`**. Run `intent/gate.sh session
claude` first. Read each gap node below (`bun tools/kb/packages/app/cli/src/main.ts
get <id>`), then `ui/src/lib/selection-keymap*.ts` (the existing pure keymap —
the pattern to extend, not to duplicate), `ui/src/lib/run-command.ts`,
`ui/src/components/outline/node-command-palette.tsx`, and the outline keydown
handler the gap names. `harness/src/constraints.ts` defines the zone matrix
your imports must satisfy (`lib` may not import `stores`; that is gap 6).

You own: `tools/kb/packages/app/ui/src/lib/*keymap*`, `lib/run-command.ts`,
`lib/commands*` (new), `components/outline/node-command-palette*`, the outline
keydown handler and its tests, `components/command-palette/**` if the registry
lands there. You do **not** own `components/canvas/**` (g3), `stores/**`
beyond reading, `constraints.ts`, `.oxlintrc.json`, the baseline. Known red
you do not touch: `packages/domain/model/tests/kinds.test.ts` (g1).

## Gaps, in order

1. `01M1MGCH7SD69CRSSV75X789QW` — `mapSelectionKey` is a 46-branch chain.
   Table of `{key, mods, toAction}` entries. **Behaviour-preserving only if
   first-match order is reproduced exactly** — write the characterization
   test first (every chord the chain handles, in order, plus the fall-through
   cases), then replace.
2. `01M1MGCDRS0K28YBF1Q86YY61S` — `applySelectionAction` is a 30-branch
   switch. SLAP-extract each case body, then `Record<SelectionKeyAction["type"],
   (a) => void>`. Exhaustiveness via the type, not a default branch.
3. `01M1MGCQKVQCG3H9YYCWQX0A0Y` — the outline keydown handler (64 branches).
   `mapEditingKey` (pure, chord → intent) + `applyEditingIntent`, mirroring
   1 and 2. Same characterization-first discipline. Do it after 1 and 2 so
   the two keymaps share one chord-matching helper — one mechanism for
   "does this event match this chord", not two.
4. `01M1MGCRNVNBE5HW27Z83PK67B` — `runPaletteCommand` dispatches 37 ways, and
5. `01M1MGCF0ECBDEPTHPKMSQ4YFD` — `NodeCommandPalette` assembles and renders
   in one 24-branch component. **One registry serves both**: each command is
   registered beside its implementation (`id`, `title`, `when(node, state)`,
   `run(ctx)`); the global palette and the node palette are two *queries* over
   the registry (global vs node-scoped), and the runner is a lookup. Commands
   that are `sys.command` nodes in the store stay the source of title/keys —
   the registry binds an id to a handler, it does not restate the node.
6. `01M1RXMQPVJKREGDS7D37J1MWN` — `lib/` reaches into stores. Only the
   `run-command` part is yours: the runner takes its state as an argument
   from the palette that already holds it. Leave `toast` and `canvas-api`
   (named in the same gap) alone and say so; the gap stays open with a note
   of what remains.

Every gap you close: `status=done` via the CLI, `// GAP [[id]]` markers off.

## Rules

- Characterization test before every replacement; it passes unchanged through
  the refactor commit.
- `complexity` and `max-lines-per-function` are live lint gates — a new
  function that trips them is not a fix.
- No `.skip`, no new `oxlint-disable`, no baseline edits.

## Commits

1. `test(kb-ui): characterize selection and editing keymaps` (tables of
   chords, current behaviour pinned).
2. `refactor(kb-ui): selection keys map through a table; actions through a record`
3. `refactor(kb-ui): outline editing keys map through the same helper`
4. `refactor(kb-ui): one command registry behind both palettes and the runner`
5. `chore(kb): close keymap and command gaps` — statuses, docs.

Gates before each commit, from `tools/kb`: `bun run verify`, `bun run
test:ui`, `bun test packages` (only the 3 known fails). Background commits.

## Ownership answers

Files above: yes. New files under `lib/` or `components/command-palette/`:
yes. A store API change: no — report it. Anything else: smallest call,
record, continue.

## Report

`docs/kb/waves/2026-09-09/reports/g4.md`: per gap, closed or not and the
commit; the chord tables; the registry's shape and how the two palettes query
it; what remains of gap 6; test output; "Calls I made".
