# t1-catalog-alias — report

Wave `t1` of `docs/kb/waves/2026-09-04/plan.md`.
Harness: `omp`.
Branch: `feature/t1-catalog-alias`.

---

## 1. Diff Summary

All changes land the clean abstraction: the catalog is the single source of truth for external dependency versions with zero exceptions. `OFF_CATALOG_BY_DECISION` is deleted.

| File | Change |
|---|---|
| `tools/kb/package.json` | Added `"vite": "npm:@voidzero-dev/vite-plus-core@0.2.8"` and `"vite-plus": "0.2.8"` to `workspaces.catalog`. Converted root `devDependencies` entries for `vite` and `vite-plus` to `"catalog:"`. |
| `tools/kb/packages/ui/package.json` | Converted `devDependencies.vite` and `devDependencies["vite-plus"]` from literals to `"catalog:"`. |
| `tools/kb/bun.lock` | Updated lockfile recording catalog resolution for `vite` and `vite-plus`. Verified with `bun install --frozen-lockfile`. |
| `tools/kb/packages/harness/src/constraints.ts` | Deleted `OFF_CATALOG_BY_DECISION` and its comment table. |
| `tools/kb/packages/harness/tests/version-authored-once.test.ts` | Removed `OFF_CATALOG_BY_DECISION` import and bypass checks in manifest dependency assertions. Added test `"the vite alias pins the same version as vite-plus"` ensuring `catalog.vite` alias version strictly matches `catalog["vite-plus"]`. |
| `tools/kb/DESIGN.md` | Updated § "Supply chain" to document that the catalog names external versions with no exceptions, and the harness asserts the vite alias twin tracks `vite-plus`. |

---

## 2. Red-Case Demonstration

To verify the new harness invariant (*"the vite alias pins the same version as vite-plus"*), `catalog["vite-plus"]` was temporarily bumped from `"0.2.8"` to `"0.2.9"` in `tools/kb/package.json` while leaving `catalog.vite` at `"npm:@voidzero-dev/vite-plus-core@0.2.8"`.

Execution output:

```text
$ cd tools/kb && bun test packages/harness/tests/version-authored-once.test.ts
bun test v1.3.14 (d1632b29)

packages/harness/tests/version-authored-once.test.ts:
88 |     const match = /^npm:@voidzero-dev\/vite-plus-core@(.+)$/.exec(viteSpec);
89 |     expect(
90 |       match,
91 |       `catalog.vite (${viteSpec}) is not an npm:@voidzero-dev/vite-plus-core@<version> alias`,
92 |     ).not.toBeNull();
93 |     expect(match?.[1]).toBe(vitePlusSpec);
                            ^
error: expect(received).toBe(expected)

Expected: "0.2.9"
Received: "0.2.8"

      at <anonymous> (/Volumes/Data/workspace/repos/_worktrees/.dotfiles/t1-catalog-alias/tools/kb/packages/harness/tests/version-authored-once.test.ts:93:24)
(fail) version-authored-once > the vite alias pins the same version as vite-plus [0.72ms]

 5 pass
 1 fail
 12 expect() calls
Ran 6 tests across 1 file. [34.00ms]
```

Restoring `vite-plus` to `"0.2.8"` returns the test suite to all pass:

```text
bun test v1.3.14 (d1632b29)

 6 pass
 0 fail
 12 expect() calls
Ran 6 tests across 1 file. [44.00ms]
```

---

## 3. Bun Lockfile & Catalog Behavior

Bun catalog resolution with alias specifiers (`npm:<pkg>@<ver>`) behaved cleanly and deterministically:
1. Catalog definition:
   ```json
   "catalog": {
     ...
     "vite": "npm:@voidzero-dev/vite-plus-core@0.2.8",
     "vite-plus": "0.2.8",
     ...
   }
   ```
2. Consumers (`tools/kb/package.json` devDependencies and `packages/ui/package.json` devDependencies):
   ```json
   "vite": "catalog:",
   "vite-plus": "catalog:"
   ```
3. `bun.lock`:
   Recorded resolutions mapping `"catalog:"` directly to `"npm:@voidzero-dev/vite-plus-core@0.2.8"` and `"0.2.8"` without requiring any exceptions or off-catalog exemptions.
4. Frozen verification:
   `bun install --frozen-lockfile` completed with zero changes:
   ```text
   Checked 646 installs across 872 packages (no changes) [1157.00ms]
   ```

---

## 4. Acceptance Criteria Verification

- [x] **`bun run verify` is green**:
  - `nx run-many -t typecheck`: 17/17 projects passed.
  - `oxlint`: passed.
  - `vp fmt packages --check`: passed.
  - `knip`: passed.
  - `bun test packages/harness`: 51 passed across 16 files.
- [x] **`git grep OFF_CATALOG tools/kb`**:
  - Zero matches found (exit code 1).
- [x] **`bun run test:ui` is green**:
  - Vitest resolves `vite` through the catalog alias; 89 test files passed (631 tests passed).
- [x] **`bun test packages`**:
  - 379 tests passed across 56 files.
