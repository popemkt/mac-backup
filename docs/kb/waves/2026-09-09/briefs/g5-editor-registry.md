# g5-editor-registry — one place maps a field type to its editor; row chrome and bullet appearance are values, not branches

Wave `g5` (batch 2) of `docs/kb/waves/2026-09-09/plan.md`. Harness: claude.
Branch `kb-g5-editors` from **`kb-merge-origin`** (batch 1 merged). Run
`intent/gate.sh session claude` first. Read each gap node
(`bun tools/kb/packages/app/cli/src/main.ts get <id>`), then
`components/outline/field-value.tsx` (the gap text says the registry "already
half-exists" there), `field-row.tsx`, `prop-value-editor.tsx`,
`ref-editor.tsx`, `bullet.tsx`, `node-block.tsx`, and the view-config /
table code the last two gaps name. Read g4's report
(`docs/kb/waves/2026-09-09/reports/g4.md`) for the shape this repo now uses
for "branches → table": characterization first, `Record` keyed by the union,
no `default:`.

You own: `components/outline/{field-row,field-value,prop-value-editor,ref-editor,bullet,node-block}*`,
`lib/bullet-mode.ts` if the bullet work reaches it, the view-config table
column and sort code the gaps name, `lib/refs*` if the RefEditor hook lands
there, their tests. **Not yours**: `components/ui/**` additions, `md-view`,
`caret`, `node-content` (g2 is moving those in parallel — if one of your files
imports them, expect g2 to rewrite that one import line; do not move them
yourself), `constraints.ts`, `.oxlintrc.json`, the baseline except via
`harness:snapshot` when a count drops.

## Gaps, in order

1. `01M1MGCHQH499KS0RV9J461F73` — `FieldRow` branches 27 ways over field type
   and edit state, and
2. `01M1MGCND3KMDYJPSSMD2E4Q9J` — `PropValueEditor` branches 24 ways over
   prop value type. **One registry serves both**: `Record<FieldType, Editor>`
   where an `Editor` carries the display component, the edit component and
   the coercion from typed input to `PropValue`. Finish the half that exists
   in `field-value.tsx`; delete the other half. Characterize first: for each
   of the six `sys.ft.*` types × {display, editing, empty}, what renders and
   what a commit writes.
3. `01M1MGCP1EF5GM8NA32JEJRJ9Q` — `RefEditor` mixes candidate search,
   keyboard handling and rendering. Lift candidate search into a hook beside
   `fuzzyNodeCandidates` (the resolver `[[` autocomplete and the typed ref
   field editor already share — do not add a second candidate source);
   RefEditor becomes presentation. Keyboard handling: if g4's `lib/keychord`
   fits (it will — chords → intents), use it; do not write a second matcher.
4. `01M1MGCMX698XJ0VDCSVQBGSQB` — `Bullet` computes its appearance with 46
   branches. `bulletAppearance(node, state) → { glyph, fill, ring, … }` pure
   record; element and classes render from it. `lib/bullet-mode.ts` already
   has `resolveBulletKind` (k1 gave it `fieldIds`); build on it, do not
   duplicate it.
5. `01M1MGCGKSAJSB6GFR30SZNATJ` — `NodeBlock` decides row chrome with 28
   branches. `resolveRowChrome(node, viewConfig) → flags` as one value; render
   from it. The outline tests reach this logic — they must pass unchanged.
6. `01M1MGCJYB7PZXM68T4AVBECYG` — `resolveTableColumns` in one 21-branch
   function. SLAP-extract `explicitColumns` / `derivedColumns` /
   `mergeColumns`; existing view-config tests stay green.
7. `01M1MGCKK69CQBZQYAKRMESW5S` — the multi-key sort comparator is a 29-branch
   inline function. `compareByField(fieldId, dir)` + a compose helper.

Every gap you close: `status=done` via the CLI, `// GAP [[id]]` markers off,
and the `oxlint-disable-next-line complexity -- GAP [[id]]` lines those files
carry come off with them — `complexity` is a live gate, so the refactor must
actually bring each function under the threshold, not move the disable.

## Rules

- Characterization before replacement; passes unchanged through the refactor
  commit.
- No `.skip`, no new `oxlint-disable`; `max-lines-per-function` count may only
  drop (snapshot when it does).
- Rule 1 on the registry: if a type needs a special case, the special case is
  a *field of its registry entry*, never an `if (type === …)` at a call site.

## Commits

1. `test(kb-ui): characterize field editors, bullet appearance and row chrome`
2. `refactor(kb-ui): one editor registry behind FieldRow and PropValueEditor`
3. `refactor(kb-ui): RefEditor is presentation over a candidate hook`
4. `refactor(kb-ui): bullet appearance and row chrome are values`
5. `refactor(kb-ui): table columns and sort compose from named steps`
6. `chore(kb): close editor gaps`

Gates before each: `bun run verify`, `bun run test:ui`, `bun test packages`.
Background commits.

## Ownership answers

Files above: yes. `lib/` additions for the hook/registry: yes. A store API
change: no — report. Anything else: smallest call, record, continue.

## Report

`docs/kb/waves/2026-09-09/reports/g5.md`: per gap, closed or not and the
commit; the registry's shape (one table, its columns); `complexity` and
`max-lines-per-function` counts before/after; which imports g2 may have
rewritten under you (check `git log` on your files at the end); test output;
"Calls I made".
