# t1-catalog-alias — the catalog holds the vite alias; the exception table goes

Wave `t1` of `docs/kb/waves/2026-09-04/plan.md`. Harness: omp. Branch from
`main`. Runs in parallel with `t2`, which owns everything under
`tools/kb/packages/harness/` **except** the two files named below — touch only
those two there.

Read first: `AGENTS.md` Rule 1, `tools/kb/DESIGN.md` § "Version authored
once" (around line 215), `tools/kb/packages/harness/tests/version-authored-once.test.ts`.
Run `intent/gate.sh session omp` first. Work in `tools/kb` for bun commands.

## Fact (measured by the coordinator)

Bun catalogs accept alias specs. In a scratch workspace,
`"catalog": {"vite": "npm:@voidzero-dev/vite-plus-core@0.2.8", "vite-plus": "0.2.8"}`
with consumers saying `"vite": "catalog:"` resolved and locked cleanly
(`bun install --lockfile-only`). The comment on `OFF_CATALOG_BY_DECISION`
("an alias specifier cannot reference a catalog entry") is therefore wrong,
and the table exists only to excuse two literals.

## Do exactly this

1. `tools/kb/package.json`: add `vite` (`npm:@voidzero-dev/vite-plus-core@0.2.8`)
   and `vite-plus` (`0.2.8`) to `workspaces.catalog`; both root
   `devDependencies` entries become `"catalog:"`.
2. `tools/kb/packages/ui/package.json`: `vite` and `vite-plus` become `"catalog:"`.
3. `bun install` (not `--frozen-lockfile`) so `bun.lock` records the catalog
   resolution; then `bun install --frozen-lockfile` must succeed. Commit the
   lockfile.
4. `tools/kb/packages/harness/src/constraints.ts`: delete
   `OFF_CATALOG_BY_DECISION` and its comment.
5. `tools/kb/packages/harness/tests/version-authored-once.test.ts`: delete the
   import and the two `if (OFF_CATALOG_BY_DECISION…)` lines. Add one test:
   *"the vite alias pins the same version as vite-plus"* — parse the version
   out of `catalog.vite` (`npm:@voidzero-dev/vite-plus-core@<v>`) and assert it
   equals `catalog["vite-plus"]`. This is the invariant the old comment was
   protecting; state it as a check, not an exemption. Red case in the
   docstring: bump one of the two.
6. `tools/kb/DESIGN.md` § "Version authored once": the sentence naming
   `OFF_CATALOG_BY_DECISION` becomes: the catalog is the only file that names a
   version, with no exceptions; the vite alias twin lives in the catalog and the
   harness asserts it tracks `vite-plus`.

## Acceptance

- `bun run verify` green; `bun test packages/harness` green; the new test goes
  red when `catalog["vite-plus"]` is bumped alone (show the red run in the report).
- `git grep OFF_CATALOG` returns nothing.
- `bun run test:ui` still green (vitest resolves `vite` through the alias).

## Report

`docs/kb/waves/2026-09-04/reports/t1-catalog-alias.md`: the diff summary, the
red-case output, anything Bun did unexpectedly with the alias in the lockfile.
