# u3-store-reset-fixture — the outline store's empty state is stated once

Wave `u3` of `docs/kb/waves/2026-09-07/plan.md` (Decision 6). Harness: cursor.
Branch from `main` @ `bd2303b`. You own: `tools/kb/packages/app/ui/src/stores/outline.store.ts`
**only** to export its initial state (no other change there), a **new**
`tools/kb/packages/app/ui/src/test-support/outline-store.ts` (or the
existing `src/test-setup.ts` neighbourhood — pick the one place `ARCHITECTURE.md`
would predict and say why), the 18 test files that call
`useOutlineStore.setState({ … })` with a hand-copied literal (list them with
`rg -l "useOutlineStore.setState" packages/app/ui/src`), gap node
`01M1P63E3Y5KVHV3XMM6TBV2BM` (mark it done through the CLI), and your report.

Read first: `stores/outline.store.ts` :233 (`create<OutlineState>(…)` — the
initial values are inlined into the store factory; that is why 18 tests copy
them), two of the literals side by side (e.g. `lib/graph-view.ordering.test.ts`
:17 and `lib/instance-key.test.ts` :8 — note they already differ in which
fields they list), `ARCHITECTURE.md` "Stores" and "File layout",
`packages/app/ui/src/test-setup.ts`, the gap node's `closes` text,
`AGENTS.md` Rule 1 ("bridges over mirrors"). Run `intent/gate.sh session cursor`
first.

## Why

Eighteen files each restate what an empty outline store looks like. Any change
to the store's shape fans out to all of them, TypeScript's excess-property
check makes each edit mandatory, and they have already drifted from each
other. This is the one prerequisite for slicing the store next wave.

## Shape

- `outline.store.ts`: extract the inlined initial values into
  `export const initialOutlineState: OutlineStateData` (the data half of
  `OutlineState`, i.e. everything that is not a function — if the type does
  not split cleanly today, define `OutlineStateData = Omit<OutlineState, keyof OutlineActions>`
  or the equivalent that the file already suggests; do not restate the field
  list a second time). The store factory spreads it. Zero behaviour change.
- `test-support/outline-store.ts`: `resetOutlineStore(overrides?: Partial<OutlineStateData>)`
  = `useOutlineStore.setState({ ...initialOutlineState, ...overrides })`.
  Derived, not copied: if the store gains a field tomorrow, no test moves.
- Migrate all 18 files: each literal becomes `resetOutlineStore({ …only the
  fields that test actually sets differently… })`. Where a literal omitted
  fields the store has, the fixture now supplies the store's own defaults —
  if that changes a test's outcome, stop and report which test relied on a
  stale default; do not paper over it.
- Confirm no other file constructs an `OutlineState` literal (`rg "rootNodeId: \"__kb_root__\"" packages/app/ui/src` should hit only the store and the fixture).
- Gap `01M1P63E3Y5KVHV3XMM6TBV2BM`: `set <id> status done` via the CLI
  (`bun tools/kb/packages/app/cli/src/main.ts set … status done`; check how the
  three existing done gaps carry it and match them), then
  `action-invoke '{"id":"docs.materialize","input":{}}'`.

## Commits

1. `refactor(kb-ui): outline store initial state is a named value`
2. `test(kb-ui): resetOutlineStore fixture; 18 suites stop restating the store` (+ gap closed, docs regenerated)

## Report

`docs/kb/waves/2026-09-07/reports/u3.md`: the file list, any test whose
outcome depended on a stale literal, where the fixture lives and why,
`bun run test:ui` before/after counts, verify output.
