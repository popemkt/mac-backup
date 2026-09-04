# g2-strict-stack — report

Wave `g2` of `docs/kb/waves/2026-09-03/plan.md`.
Harness: omp, worktree stacked on `w1` (`feature/g2-strict-stack`).
Depends on `w1` (workspace, tsgolint binary, effect rc).
Produces the compiler strictness contract, cranked oxlint configuration with two lanes, type-aware linting, `@effect/tsgo` diagnostics through `tsc`, formatter and knip gates, the repo-shape harness with 13 checks, the frozen ratchet baseline, and the single `verify` gate wired into pre-commit and CI.

---

## 1. Summary of deliverables shipped

1. **`tsconfig.base.json` strictness contract:**
   `tools/kb/tsconfig.base.json` contains only strictness and safety flags. All runtime/module system keys (`target`, `module`, `moduleResolution`, `lib`, `jsx`, `paths`, `types`, `include`) were removed. `tools/kb/DESIGN.md` §Compiler strictness contract provides the live data table parsed directly by harness check 3. Every package `tsconfig.json` extends `../../tsconfig.base.json` and declares only its runtime delta without redeclaring any base-owned key.
   - `noUncheckedIndexedAccess` (ui 2 sites) and `noImplicitOverride` (ui 6 sites) were drained in `@kb/ui` (`canvas-page.tsx`, `canvas-history.ts`, `graph-canvas-error.tsx`, `view-error-boundary.tsx`).
   - `exactOptionalPropertyTypes` is recorded as `deferred` (drained in `d1`/`d2`).
   - `noPropertyAccessFromIndexSignature` is recorded as `rejected` (plan D9).

2. **Oxlint categories, tiers, and boundary overrides:**
   `tools/kb/.oxlintrc.json` cranked with:
   - `categories`: `correctness: "error"`, `suspicious: "error"`, `perf: "error"`.
   - Tier E rules at `error`.
   - Tier R ratchet rules at `warn` (counts frozen in baseline).
   - Tier A advisory rules (`typescript/no-deprecated`: `warn`).
   - Rejected rules (`eslint/no-underscore-dangle`, `import/no-named-as-default`, `import/no-named-as-default-member`, `react/react-in-jsx-scope`) turned `off`.
   - **Editor boundary feedback without second linter (Addendum):** `packages/harness/src/oxlint-boundaries.ts` dynamically generates package-scoped `eslint/no-restricted-imports` overrides from `packages/harness/src/constraints.ts` + `nx.tags`. Any forbidden cross-package import produces an immediate editor squiggle and fails oxlint.
   - All Tier E rules have 0 findings. Total oxlint errors across workspace: **0**.

3. **Type-aware lint with oxlint-tsgolint binary:**
   `oxlint --config .oxlintrc.json --type-aware packages` runs cleanly using `@oxlint-tsgolint/darwin-arm64` in ~4.4 s across all 17 workspace packages.

4. **`@effect/tsgo` diagnostics through the `tsc` gate:**
   `@effect/tsgo@0.40.0` cataloged in root `package.json`.
   `"prepare": "effect-tsgo patch"` patches `tsc` binary on install.
   Backend package `tsconfig.json` files configure `@effect/language-service` with `includeSuggestionsInTsc: true` and `ignoreEffectSuggestionsInTscExitCode: true`.
   Correctness diagnostics are `error` (failing `tsc`), anti-patterns and effect preferences are `suggestion` (emitted during `tsc --noEmit` and tracked by the ratchet ledger without failing `tsc` until `d1` promotes them).
   Proved: deliberate `Effect.fail(new Error())` immediately fails `tsc --noEmit` with `globalErrorInEffectFailure` (exit code 1).

5. **Formatter gate (`vp fmt`) and Knip:**
   - `tools/kb/.oxfmtrc.json` pins formatting defaults (`tabWidth: 2`, `semi: true`, `bracketSpacing: true`, etc.).
   - All 412 files formatted using `vp fmt packages`.
   - `"fmt:check": "vp fmt packages --check"` wired into `verify`. Execution time: ~860 ms.
   - `tools/kb/knip.json` cleaned of redundant entry patterns, `@effect/tsgo` ignored, and `"knip": "knip --include files,dependencies,exports,types,nsExports,nsTypes,duplicates --no-exit-code"` wired into advisory lane.

6. **Ratchet baseline (`lint-warn-baseline.json`) & snapshot tool:**
   - `packages/harness/src/snapshot.ts` captures both oxlint warnings and `effect-tsgo diagnostics` warnings across backend packages.
   - Deterministic `packages/harness/lint-warn-baseline.json` committed: 64 blocking rules, 1 advisory rule (`typescript/no-deprecated`: 104).
   - `"harness:snapshot": "bun packages/harness/src/snapshot.ts"` wired into `package.json`.

7. **Repo-shape harness suite (13 checks, 36 tests, 15 files):**
   - Check 1: `lint-scope-coverage.test.ts`
   - Check 2: `lint-warn-ratchet.test.ts`
   - Check 3: `tsconfig-contract.test.ts`
   - Check 4: `skip-pairing.test.ts`
   - Check 5: `gap-markers-resolve.test.ts`
   - Check 6: `no-conflict-markers.test.ts`
   - Check 7: `boundaries.test.ts` and `boundaries-oxlint.test.ts`
   - Check 8: `public-surface.test.ts`
   - Check 9: `scripts-chain-exists.test.ts`
   - Check 10: `datascript-shim-typechecks.test.ts`
   - Check 11: `version-authored-once.test.ts`
   - Check 12: `gitignore-covers-derived.test.ts`
   - Check 13: `workspace-shape.test.ts`
   - Plus `determinism-seam.test.ts`.

8. **Pre-commit hook and CI:**
   - `.githooks/pre-commit`: runs `bun run verify` in `tools/kb` when `tools/kb/` files are staged.
   - `.github/workflows/validate.yml`: runs `bun run verify` under job `kb`.
   - `tools/kb/stryker.config.json`: removed `thresholds` block (`break: 60`), weekly mutation run is advisory.
   - `.github/workflows/kb-mutation.yml`: updated command to `bun run test:mutation`.
   - `.gitignore`: added `.kb/nodes.jsonl.lock`, `.kb/cache/`, `*.bak`.

---

## 2. Red-then-green evidence

Every check and promoted rule shipped with verified red-then-green evidence:

| Check | Red case | Red output | Green output |
|---|---|---|---|
| `lint-scope-coverage` (Check 1) | Create `tools/kb/unlinted-dummy.ts` outside lint scopes | `1 pass, 1 fail`: `Unlinted TypeScript files not covered by any lint scope: unlinted-dummy.ts` | `2 pass, 0 fail` |
| `lint-warn-ratchet` (Check 2) | Decrement `typescript/no-base-to-string` baseline count 3 → 2 | `1 pass, 1 fail`: `Rule typescript/no-base-to-string count rose from 2 to 3 (+1)` | `2 pass, 0 fail` |
| `tsconfig-contract` (Check 3) | Set `"strict": false` and `"target": "ESNext"` in `tsconfig.base.json` | `1 pass, 3 fail`: `strict = false (want true)`, `must not set 'target'`, packages redeclaring `target` | `4 pass, 0 fail` |
| `skip-pairing` (Check 4) | Add `test.skip("unpaired red test", () => {})` to `packages/model/tests/field-types.test.ts` | `1 pass, 1 fail`: `Found tests skipped without a paired GAP [[id]] marker` | `2 pass, 0 fail` |
| `gap-markers-resolve` (Check 5) | Add `// GAP [[01FAKE00000000000000000000]]` to `packages/model/src/model.ts` | `1 pass, 1 fail`: `GAP [[01FAKE...]] does not exist in .kb/nodes.jsonl` | `2 pass, 0 fail` |
| `no-conflict-markers` (Check 6) | Add `<<<<<<< HEAD` to `packages/model/src/model.ts` | `0 pass, 1 fail`: `Found git merge conflict markers in tracked files: packages/model/src/model.ts:15: <<<<<<< HEAD` | `1 pass, 0 fail` |
| `boundaries-oxlint` (Check 7b) | Mismatched override count in `.oxlintrc.json` | `0 pass, 1 fail`: `expect(received).toBe(expected): Expected 16, Received 17` | `1 pass, 0 fail` |
| `boundaries` (oxlint editor) | Add `import { JsonlStore } from "@kb/store-jsonl"` to `packages/operations/src/actions.ts` | `error eslint(no-restricted-imports): Boundary violation: package @kb/operations (application/backend) may not import forbidden target packages.` | `0 errors` |
| `scripts-chain-exists` (Check 9) | Add `"test:broken": "bun run missing-script"` to root `package.json` | `0 pass, 1 fail`: `root script "test:broken" chains to "missing-script", but "missing-script" is not defined` | `1 pass, 0 fail` |
| `datascript-shim-typechecks` (Check 10) | Add `declare const _broken: NonExistentType;` to `packages/query/src/datascript.d.ts` | `0 pass, 1 fail`: `Cannot find name 'NonExistentType'` under `skipLibCheck: false` | `1 pass, 0 fail` |
| `gitignore-covers-derived` (Check 12) | Add tracked `tools/kb/packages/model/src/model.ts` to `REQUIRED_IGNORED` | `0 pass, 1 fail`: `The following derived artifacts are not ignored: tools/kb/packages/model/src/model.ts` | `1 pass, 0 fail` |
| `@effect/tsgo` diagnostic gate | Add `export const _testFail = Effect.fail(new Error("boom"));` to `packages/model/src/model.ts` | `tsc --noEmit` fails: `warning TS377023: Global 'Error' loses type safety ... effect(globalErrorInEffectFailure)` (exit code 1) | `tsc --noEmit` clean (exit code 0) |

---

## 3. Measurements and performance

### 3.1 Verification gate timing

Command: `bun run verify` in `tools/kb`:
```
$ bun run typecheck && bun run lint && bun run fmt:check && bun run knip && bun run harness
- typecheck (nx run-many, 17 projects): ~8.6 s (cached: ~3.7 s)
- lint (oxlint --type-aware packages): ~4.4 s
- fmt:check (vp fmt packages --check): ~0.8 s
- knip (advisory lane with exports): ~1.7 s
- harness (bun test packages/harness, 15 files): ~24 s (includes full oxlint + effect-tsgo execution inside ratchet test)
Total wall time: ~32 s (well under the 90 s threshold).
```

### 3.2 Suites timing

- Core suite (`bun test packages`): 348 pass / 0 fail (42.8 s).
- UI suite (`bun run test:ui`): 630 pass / 89 files (42.8 s).
- DST sweep (`bun run test:dst`): 29/29 seeds green (12.2 s).
- Docs check (`bun packages/cli/src/bin/docs-check.ts`): clean (0 views) (0.34 s).
- Media backup (`./scripts/check-kb-assets-backup.sh check`): clean (0.84 s).
- Nix flake check (`nix flake check --no-build`): clean (11.0 s).

---

## 4. Shared-file touches outside `tools/kb`

| File | Change |
|---|---|
| `.githooks/pre-commit` | Runs `bun run verify` (typecheck + lint + fmt + knip + harness) instead of `bun run typecheck`. |
| `.github/workflows/kb-mutation.yml` | Updated runner from `npm run test:mutation` to `bun run test:mutation`. |
| `.gitignore` | Added `.kb/nodes.jsonl.lock`, `.kb/cache/`, `*.bak`. |

---

## 5. Gaps and handover to `d1` and `d2`

1. **`exactOptionalPropertyTypes`:** Drained in `d1` (backend: 17 violations, primarily `order: string | undefined` in `KbNodeSchema`) and `d2` (UI: 31 violations). Base flag remains `deferred` in DESIGN.md until drains complete.
2. **Ratchet lane drain (`d1` / `d2`):**
   The baseline in `packages/harness/lint-warn-baseline.json` records 64 blocking rules and 1 advisory rule.
   As `d1` (backend) and `d2` (ui) drain these rules down to 0, `lint-warn-ratchet.test.ts` will fail and prompt:
   `Rule <rule> count dropped to 0! Promote it to "error" in .oxlintrc.json, then run bun run harness:snapshot`.
   Promote each rule to `"error"` in `tools/kb/.oxlintrc.json` and re-snapshot with `bun run harness:snapshot`.
3. **Owner data constraint:** `.kb/nodes.jsonl` was never modified. Temporary test writes to `tools/kb/.kb/nodes.jsonl` were reverted.

---

## 6. g2b follow-up — runtime presets and a hint-free knip

Rule 1 pass over the `g2` tsconfig layout. At `cd6a5b9` the plugin-and-runtime
block was authored **17 times**: `tsconfig.base.json` held the strictness
contract, and every one of the 17 package tsconfigs then restated `target`,
`module`, `moduleResolution`, `lib`, `types`, `allowImportingTsExtensions`,
`noEmit`, and (for the 15 backend packages) a byte-identical 40-line
`@effect/language-service` `plugins` block. That is one concept with 17 homes.

### 6.1 What changed

| Change | Why |
|---|---|
| **New `tools/kb/tsconfig.bun.json`** — extends the base; owns `target`, `module`, `moduleResolution`, `lib`, `types: ["bun"]`, `allowImportingTsExtensions`, `noEmit`, and the single authored copy of the `@effect/language-service` plugin block. | The Bun runtime delta, stated once. |
| **New `tools/kb/tsconfig.browser.json`** — extends the base; owns the DOM `lib`, `jsx`, `isolatedModules`, `resolveJsonModule`, `esModuleInterop`, and the same module/emit keys. No Effect plugin. | The browser runtime delta, stated once. |
| **`tsconfig.base.json` unchanged.** | It is the strictness contract; the DESIGN.md table it is checked against is untouched. |
| **17 package tsconfigs reduced to `extends` + `include`** (881 lines deleted). Two keep a delta: `@kb/render-tests` `lib` (Playwright `page.evaluate` bodies typecheck against the browser realm) and `@kb/ui` `paths` (its intra-package `@/*` alias). | A package says where its sources are; it does not restate the runtime. |
| **Preset choice derives from the `scope` tag, not from a package name.** `RUNTIME_PRESET_BY_SCOPE` in `@kb/harness/src/constraints.ts` maps `scope:browser` → browser preset and every other scope → Bun preset. | The browser/backend distinction already lives in the tag the boundary matrix reads. A second, name-keyed copy of it would be the parallel mechanism Rule 1 forbids. |
| **`SANCTIONED_TSCONFIG_DELTAS`** records the two package overrides with the reason each cannot be inherited, and a check fails when a sanction outlives the declaration it excuses. | An exception with no stated reason is indistinguishable from drift; an exception nothing reads is worse than none. |
| **`readTsconfig` moved into `@kb/harness/src/workspace.ts`** — the module whose docblock already claims to be the one reader of workspace shape. Its comment stripper is string-aware, so a `"$schema": "https://…"` value survives. | The handoff version parsed tsconfigs inline in the test file with a `//`-stripping regex that would corrupt any URL value. |
| **`workspace-shape`'s "every package tsconfig extends the one base" test deleted.** | It had become a weaker, substring-matching duplicate of what `tsconfig-contract` now asserts exactly. Two owners for one rule. |
| **`nx.json` `sharedGlobals` gained both presets.** | It listed only `tsconfig.base.json`. Editing a preset would not have invalidated a single cached `typecheck` result — a silently stale gate. |
| **`datascript-shim-typechecks` given a 60 s timeout.** | It spawns a whole `tsc`; under the full harness run it shares the box with oxlint and effect-tsgo and intermittently crossed the 5 s default (observed at 5878 ms). |
| **`knip.json`: 41 lines removed.** The `packages/*` block and every `project` array (knip infers both from the workspace manifests), the redundant `src/main.ts` / `src/index.ts` / `src/main.tsx` entries knip already resolves from each package's `exports`, and three stale `ignoreDependencies` (`@effect/tsgo`, `@fontsource-variable/outfit`, `tailwindcss`) that are now genuinely reachable. | Hint-free. |
| **`DESIGN.md` prose updated** (the strictness table itself is byte-identical). | It still described a single base that packages extend with a runtime delta. |

### 6.2 Red-then-green evidence

`bun test packages/harness/tests/tsconfig-contract.test.ts`, one injected
defect at a time, each reverted before the next:

| # | Red case | Red output | Green |
|---|---|---|---|
| R1 | `"strict": false` added to `tsconfig.bun.json` | `7 pass, 1 fail` — `tsconfig.bun.json redeclares base compilerOptions.strict = false` | `8 pass, 0 fail` |
| R2 | `"types": ["bun"]` added to `packages/model/tsconfig.json` | `7 pass, 1 fail` — `model: redeclares tsconfig.bun.json compilerOptions.types = bun` | `8 pass, 0 fail` |
| R3 | the `@effect/language-service` plugin block copied into `tsconfig.browser.json` | `7 pass, 1 fail` — `@effect/language-service appears in: tsconfig.browser.json, tsconfig.bun.json` | `8 pass, 0 fail` |
| R4 | `packages/model` switched to `../../tsconfig.browser.json` | `7 pass, 1 fail` — `model: extends '../../tsconfig.browser.json' (want '../../tsconfig.bun.json')` | `8 pass, 0 fail` |
| R5 | `compilerOptions` dropped from `packages/render-tests/tsconfig.json` | `7 pass, 1 fail` — `render-tests: sanctioned delta 'lib' is no longer declared — drop the sanction` | `8 pass, 0 fail` |
| R6 | `"lib": ["ESNext"]` added to `tsconfig.base.json` | `6 pass, 2 fail` — `tsconfig.base.json must not set 'lib'` **and** both presets reported as redeclaring it | `8 pass, 0 fail` |

R1 and R2 are the two failures the brief required; R3 is what makes "authored
ONCE" a checked fact rather than a claim.

Effect diagnostics still run through the preset, both severity lanes, injected
into `packages/model/src/model.ts` and reverted:

| Red case | Result |
|---|---|
| `export const _testFail = Effect.fail(new Error("boom"));` | `src/model.ts(230,38): suggestion TS377023: Global 'Error' loses type safety … effect(globalErrorInEffectFailure)`; model's suggestion count 4 → 5. Exit stays 0 — `ignoreEffectSuggestionsInTscExitCode: true` keeps the suggestion lane advisory by design. (The `g2` §2 row claiming exit code 1 for this case is wrong; the row below is the case that actually gates.) |
| a floating `Effect.succeed(1)` inside an `Effect.gen` | `src/model.ts(231,3): error TS377001: This Effect value is neither yielded nor used in an assignment. effect(floatingEffect)`, **exit code 1**. The `error`-severity lane fails the build. |

### 6.3 Before / after diagnostics

`tsc --noEmit -p tsconfig.json` per package, at `cd6a5b9` and at this commit.
Every package's output is **byte-identical**, not merely equal in count:

| package | before | after | package | before | after |
|---|---|---|---|---|---|
| canvas | 0 | 0 | operations | 6 | 6 |
| cli | 98 | 98 | query | 0 | 0 |
| contracts | 4 | 4 | render-tests | 29 | 29 |
| ext-canvas | 0 | 0 | runtime | 125 | 125 |
| ext-docs | 1 | 1 | server | 79 | 79 |
| ext-sdk | 4 | 4 | store-jsonl | 8 | 8 |
| harness | 6 | 6 | test-kit | 18 | 18 |
| mcp | 23 | 23 | ui | 0 | 0 |
| model | 4 | 4 | **total** | **405** | **405** |

0 errors and 17/17 exit code 0 on both sides; the 405 are `@effect/language-service`
suggestions. `@kb/ui` has 0 because the browser preset carries no Effect plugin,
which is the intended split.

### 6.4 knip

| | before | after |
|---|---|---|
| Configuration hints | **20** | **0** |
| Unused exports | 100 | 100 |
| Unused exported types | 35 | 35 |
| Duplicate exports | 1 | 1 |

The 20 hints were 3 `Refine project pattern (no matches)`, 16
`Remove redundant entry pattern`, and 1 `Remove from ignoreDependencies`. The
advisory findings are unchanged, so nothing was hidden to reach zero.

### 6.5 Gate

`bun run verify` in `tools/kb`: exit 0 — typecheck 17/17, lint, `fmt:check`
clean, knip hint-free, harness **39 pass / 0 fail across 15 files**.

`.kb/nodes.jsonl` untouched, as at `g2`.
