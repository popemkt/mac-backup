# u1-ui-matrix — the UI's import rules stop being a markdown table

Wave `u1` of `docs/kb/waves/2026-09-07/plan.md` (Decision 5). Harness: claude
(opus, high). Branch from `main` @ `bd2303b`. You own:
`tools/kb/harness/src/constraints.ts` (add beside the package matrix; do not
reshape what is there), a **new** `tools/kb/harness/src/ui-imports.ts` if the
scan needs a module, a **new** `tools/kb/harness/tests/ui-boundaries.test.ts`,
the "Import / ownership rules" section of
`tools/kb/packages/app/ui/ARCHITECTURE.md`, `GAP [[id]]` lines on sanctioned
import sites in `tools/kb/packages/app/ui/src/**` (no other edits there — you
fence, you do not refactor), the `#gap` nodes those markers name, the
`harness` paragraph in `tools/kb/AGENTS.md` if the matrix's home changes, and
your report. `u2` (canvas split) runs beside you and may create files under
`components/canvas/`; do not touch that folder beyond marker lines.

Read first: `harness/src/constraints.ts` (the matrix and its doc comment: one
statement, the check applies it), `harness/src/import-graph.ts` and
`harness/tests/boundaries.test.ts` (how imports are read — reuse the reader,
do not write a second import parser), `harness/src/suppressions.ts` +
`harness/tests/gap-markers-resolve.test.ts` (the `GAP [[id]]` grammar and
resolution), `harness/src/ratchet.ts` + `lint-warn-ratchet.test.ts` (the
baseline lane, if you need it), `packages/app/ui/ARCHITECTURE.md` "Import /
ownership rules" (the table you are replacing), the two-mechanism rule under
`AGENTS.md` "Drift markers and gaps", the governance review's UI ownership
finding (`docs/kb/waves/2026-09-04/reports/kb-comprehensive-architecture-governance-review.md`,
search "UI ownership"). Run `intent/gate.sh session claude-code` first.

## Why

`ARCHITECTURE.md` states who may import whom inside the UI. Nothing checks it.
The review measured the breaches as overstated but real, and the two hotspot
splits ahead (canvas now, outline store next) need the fence up first so a
split cannot land as a new tangle. The canonical-statements rule also says a
table nothing reads is a restatement waiting to drift.

## Shape

`constraints.ts`:

- `UI_SRC = "packages/app/ui/src"` and `UI_ALLOWS: Record<UiZone, readonly UiZone[]>`
  with zones derived from the first path segment(s) under `src/`: `ds`, `lib`,
  `api`, `actions`, `stores`, `session`, `fixtures`, `catalog`,
  `components/<surface>` for each surface folder, plus the named shared
  primitives (`components/outline/{tag-chip,bullet,node-row,field-*}`,
  `components/view-error-boundary.tsx`, `components/ui/**`,
  `components/popover-shell*`) as one zone `primitives`. Encode exactly the
  rows of today's table; where the table is ambiguous, pick the stricter
  reading and say so in the report. `zoneOf(file): UiZone` is the one
  function that knows the mapping; `App.tsx` and `main.tsx` are zone `shell`
  and may import every surface.
- Relative and `@/…` imports resolve to files; `@kb/*` and third-party
  specifiers are outside this matrix (the package matrix owns `@kb/*`).
  `ds/` remains the only zone that may import `@kb/query` — that row is the
  one specifier rule in this table; state it as a single-entry
  `UI_SPECIFIER_ALLOWS`, not an `if`.
- Test files (`*.test.ts(x)`, `catalog/`) are exempt from the surface rows but
  not from the `ds` rule.

`ui-boundaries.test.ts`: one test per axis — every import in `UI_SRC` resolves
to an allowed zone; every `GAP [[id]]` on an import line names an existing
`#gap` node (reuse the resolver); zones in `UI_ALLOWS` are exactly the folders
present (a row for a folder that does not exist fails; a folder without a row
fails).

Violations: count them first (put the count in the report). ≤ ~30 ⇒ each
import line carries `// GAP [[id]]` and one `#gap` node per *distinct
dependency* (surface A → surface B internals), not per line, with `closes` =
the split that removes it and `rule` = the UI-ownership rule node you add
(`#rule`, `home` = `tools/kb/harness/src/constraints.ts#ui`, `enforcement`
… leave `enforcement` as `prose` and set `gate` = `harness ui-boundaries`;
wave c1 derives it). > 30 ⇒ a frozen baseline in the ratchet lane, written by
the existing snapshot mechanism, never by hand.

`ARCHITECTURE.md`: the table becomes two sentences — the rule lives in
`constraints.ts` `UI_ALLOWS`, the harness enforces it, exemptions are gaps —
and the "Shared primitives" list moves into the `primitives` zone definition
(the doc links to it, does not restate it).

## Commits

1. `feat(kb): UI import matrix in constraints.ts; harness enforces it` (matrix + test + markers/baseline + gap nodes + rule node)
2. `docs(kb-ui): ARCHITECTURE.md points at the matrix instead of restating it`

## Report

`docs/kb/waves/2026-09-07/reports/u1.md`: the zone list, the violation count
and mechanism chosen, each distinct cross-surface dependency with its gap id,
ambiguities you resolved strictly, verify / harness output.
