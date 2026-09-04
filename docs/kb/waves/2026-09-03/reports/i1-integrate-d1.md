# i1-integrate-d1 — report

Integration wave `i1` of `docs/kb/waves/2026-09-03/plan.md`.
Harness: claude (opus), worktree `i1-integrate-d1`, branch
**`feature/i1-integrate-d1`**.

Merged `feature/d1-drain-backend` (`757b0b6`, 2 commits on top of `g2`
`cd6a5b9`) into the Track 1 integration branch `kb-wave/2026-09-03`
(`6d05ad4` = w1 + g2/g2b + d3 + d2 + r2).

Merge commit: **`2d874a3`** — parents `6d05ad4` (Track 1) and `757b0b6` (d1).
One merge commit; no follow-up fix commit was needed (every fix is inside the
merge resolution). `bun run verify`: **green**.

---

## 1. The twelve conflicts and how each was resolved

`git merge --no-ff` reported 12 content conflicts. The merge base is `cd6a5b9`
(g2), so every conflict is "d3/d2/r2 changed it" vs "d1 changed it".

| # | File | Resolution |
|---|---|---|
| 1 | `packages/ui/tsconfig.json` | **HEAD.** g2b reduced it to `extends` + `paths` + `include`; d1 had bumped `lib` `ES2022` → `ES2023` so backend `.toSorted()` typechecks when the ui `tsc` pulls `@kb/model` source. `tsconfig.browser.json` already declares `lib: ["ESNext", "DOM", "DOM.Iterable"]` (d2 §3), which is a superset — d1's intent is satisfied by the preset, and a package-level `lib` would fail `tsconfig-contract`. |
| 2 | `.oxlintrc.json` | **Union** — see §2. |
| 3 | `packages/harness/lint-warn-baseline.json` | Not hand-merged. Regenerated with `bun run harness:snapshot` after every code conflict was resolved; verified against both parents (§3). |
| 4 | `packages/ext-docs/src/todos.ts` (vs `packages/operations/src/docs/templates.ts`) | Git detected the d3 rename, so d1's SLAP extraction (`statusRank`, `firstScalar`, `nodeStatus`, `collectProjectNodes`, `renderStatusGroups`, `todosByProject`, `todosFlat`) auto-merged onto the moved file. The only conflicting hunk was d1's local copy of `TemplateContext` / `TemplateFn` / `renderText`; **HEAD wins** — those live in `@kb/contracts` and `@kb/operations/docs/text.ts` now. `operations/src/docs/templates.ts` stays deleted. |
| 5 | `packages/operations/src/docs/docs.ts` | **Both.** Re-export block: d1's (`export { DocsError, loadViewsEffect } from "./views.ts"`, still live — `render.ts` imports through it). d1 un-exported `ViewSpecSchema` in `views.ts`, so HEAD's re-export of it would not have compiled; `renderText` is not re-added because `operations/src/index.ts` exports it from `./docs/text.ts` directly. Unknown-template failure: HEAD's `TemplateRegistry` map (`[...templates.keys()]`) with d1's `.toSorted()`. |
| 6 | `packages/operations/src/extension-loader.ts` | **HEAD.** d3's contribution loop already carries d1's `problem !== null` narrowing and routes both branches through the single `asRecord` seam. |
| 7 | `packages/operations/src/render.ts` | **Both.** HEAD's `TemplateRegistry` in `RenderEnv`, d1's `present` import (the narrowing helper `mdToHtml` now uses). |
| 8 | `packages/runtime/src/index.ts` | **Both.** HEAD's barrel (`invoke` from `./invoke.ts`, `RegisteredTemplate` type) plus d1's `writeErr` / `writeOut` from `./output.ts`. |
| 9 | `packages/runtime/src/layers.ts` | **Both.** HEAD's `kbRuntimeLayer` (FileSystem + store + ctx + `TemplateRegistry`); d1's deletion of the dead `jsonlStoreLayer` export kept (nothing imports it) and its type-only `KbStore` import kept. |
| 10 | `packages/runtime/src/registry.ts` | **Both.** HEAD's `RegisteredTemplate` / template registration path; d1's `writeErr` instead of `console.error`, `ensureDomainError`, the un-exported `RegistryExtension`, and the deleted `ExtensionAction` import (unused after d3's loader change). `Cause` / `Exit` are gone because `invoke` moved to `invoke.ts`. `KbCtx` / `KbStore` / `TemplateRegistry` are type-only here and folded into the one `@kb/contracts` import (§3, `import/no-duplicates`). |
| 11 | `packages/runtime/tests/ontology.test.ts` | **Both test sets** (they auto-merged); the conflict was only the import line — `invoke` from `../src/invoke.ts` (HEAD's move) with d1's removal of the duplicate `canonicalJson` import. |
| 12 | `packages/server/src/http.ts` | **HEAD.** d3 had already collapsed the hand-assembled runtime into the single `Effect.provide(kbRuntimeLayer(deps.ctx))` that d1 wanted; HEAD's import list is the minimal one (`type KbContext` only — `KbStore` / `KbCtx` / `FileSystem` are unused after `ActionHandlerEnv`). |

`bun.lock` auto-merged; `bun install --frozen-lockfile` succeeded against it
unchanged, so no re-lock was needed.

### Rule 1 posture

Every resolution keeps **d3's structure and d1's collapses at the same time**:
one `TemplateRegistry`, one `kbRuntimeLayer`, one `ensureDomainError`, one
output seam, one config seam. No export d1 deleted was re-added; the two that
looked live (`ViewSpecSchema`, `renderText` off `docs.ts`) were checked against
their importers first and stayed deleted.

## 2. `.oxlintrc.json` — union, then the promotions the union unlocked

Two conflicting hunks, both resolved as a union:

- `node/no-process-env` → `error` (d1) **and** `react/rules-of-hooks` → `error` (d2).
- `no-console` seam allowlist: d1's `packages/runtime/src/output.ts` (the CLI
  seam files d1 deleted are dropped) **and** d2's `packages/ui/src/lib/log.ts`.

Everything else auto-merged: d2's 11 ui promotions and d1's two scoped override
blocks (backend-all, backend-src) all landed.

**Then the ratchet failed** — and this is the point of the integration wave.
Thirteen rules were at 0 in backend after d1 and at 0 in ui after d2, but
neither wave could see the other half, so each left the rule at `warn`. On one
branch they are 0 workspace-wide, and harness check 2 demands promotion:

| Promoted to global `error` | be at 0 by | ui at 0 by |
|---|---|---|
| `eslint/complexity` | d1 | d2 (23 disables + `#gap` nodes) |
| `eslint/no-console` | d1 (runtime seam) | d2 (`log.ts` seam) |
| `eslint/no-eq-null` | d1 | d2 |
| `typescript/await-thenable` | d1 | d2 |
| `typescript/consistent-type-imports` | d1 | d2 |
| `typescript/no-unnecessary-boolean-literal-compare` | d1 | d2 |
| `typescript/no-unnecessary-type-assertion` | d1 | d2 |
| `typescript/no-unnecessary-type-conversion` | d1 | d2 |
| `typescript/require-await` | d1 | d2 (test-file scope, §7k of d2) |
| `unicorn/no-array-reverse` | d1 | d2 |
| `unicorn/no-array-sort` | d1 | d2 |

Two `@effect/tsgo` anti-pattern diagnostics reached 0 the same way and were
promoted `suggestion` → `error` in `tsconfig.bun.json` (plan A.7 puts the
anti-pattern group on lane:R → `error`):
`unknownInEffectCatch`, `unnecessaryFailYieldableError`.

**d1's `backend-all` override block is deleted.** All seven rules in it
(`promise/always-return`, `no-unnecessary-type-assertion`, `no-console`,
`consistent-type-imports`, `require-await`, `no-array-sort`, `complexity`) are
now `error` globally, so the block was a second home for a decision the global
`rules` object already states. The `backend-src` block stays: its three rules
(`no-non-null-assertion`, `strict-boolean-expressions`,
`no-unnecessary-condition`) are still non-zero in ui and in backend tests.

The `off` overrides that make some of these reachable at 0 are untouched:
tests (`no-console`, `require-await`, `no-await-in-loop`, …), the output seams,
and `packages/server/src/paths.ts` for `node/no-process-env`.

## 3. Red-then-green evidence

Standing constraint 3: every promoted rule ships red-then-green. All thirteen
were demonstrated red on throwaway files under `packages/ui/src` and
`packages/model/src` (a **ui** scope for the oxlint ones, deliberately — the
promotion being proved is the *global* one, not d1's backend-scoped one), then
the files were deleted and the workspace re-linted at 0 errors.

| Rule | Red output (abridged) |
|---|---|
| `eslint/no-console` | `error eslint(no-console): Unexpected console statement.` |
| `eslint/no-eq-null` | `error eslint(no-eq-null): Do not use \`null\` comparisons without type-checking operators.` |
| `eslint/complexity` | `error eslint(complexity): function \`complex\` has a complexity of 23. Maximum allowed is 20.` |
| `unicorn/no-array-reverse` | `error unicorn(no-array-reverse): Use \`Array#toReversed()\` instead of \`Array#reverse()\`.` |
| `unicorn/no-array-sort` | `error unicorn(no-array-sort): Use \`Array#toSorted()\` instead of \`Array#sort()\`.` |
| `typescript/await-thenable` | `error typescript(await-thenable): Unexpected \`await\` of a non-Promise (non-"Thenable") value.` |
| `typescript/require-await` | `error typescript(require-await): Function has no 'await' expression.` |
| `typescript/no-unnecessary-boolean-literal-compare` | `error typescript(no-unnecessary-boolean-literal-compare): This expression unnecessarily compares a boolean value to a boolean…` |
| `typescript/no-unnecessary-type-conversion` | `error typescript(no-unnecessary-type-conversion): This type conversion does not change the type or value of the expression.` |
| `typescript/no-unnecessary-type-assertion` | `error typescript(no-unnecessary-type-assertion): This assertion is unnecessary since it does not change the type of the expression.` |
| `typescript/consistent-type-imports` | `error typescript(consistent-type-imports): All imports in the declaration are only used as types. Use \`import type\`.` |
| `effect/unnecessaryFailYieldableError` | `error TS377019: This \`yield* Effect.fail(...)\` passes a yieldable error value.` — and `tsc -p packages/model` reports it at **error** severity, not suggestion |
| `effect/unknownInEffectCatch` | `error TS…: The \`catch\` callback in \`Effect.try\` returns \`unknown\`, so the Effect error type stays untyped` |

Green: `bun run lint` exit 0 with 0 errors and `bun run typecheck` 17/17 after
the proof files were removed.

### Two rises caught by the ratchet and fixed rather than absorbed

The first snapshot showed two rules above **d1's** parent count (both were
below HEAD's, so a naive "no rise vs HEAD" check would have missed them):

| Rule | HEAD | d1 | first merge | fixed by |
|---|---:|---:|---:|---|
| `effect/multipleEffectProvide` | 6 | 2 | 3 | `packages/runtime/tests/native-actions.test.ts` chained `Effect.provide(bunFileSystemLayer)` + `Effect.provide(templateRegistryLayer(…))`; collapsed into one `Layer.mergeAll`, which is exactly the shape d1 established for the src sites |
| `import/no-duplicates` | 21 | 7 | 8 | the conflict resolution left `registry.ts` with two `@kb/contracts` imports; folded into one |

## 4. Final per-rule ratchet table

`HEAD` = Track 1 parent (`6d05ad4`, d2's snapshot). `d1` = `757b0b6`.
`merged` = `packages/harness/lint-warn-baseline.json` at `2d874a3`.
**No rule rose above either parent.** Blocking ledger: 56 (HEAD) / 59 (d1) → **40**.

| Rule | HEAD | d1 | merged | note |
|---|---:|---:|---:|---|
| `effect/anyUnknownInErrorContext` | 7 | 6 | 6 | |
| `effect/asyncFunction` | 312 | 303 | 303 | |
| `effect/catchToIgnore` | 1 | 1 | 1 | |
| `effect/catchToOrElseSucceed` | 4 | 4 | 4 | |
| `effect/effectMapVoid` | 1 | 1 | 1 | |
| `effect/globalConsole` | 23 | 17 | 17 | |
| `effect/globalDate` | 11 | 11 | 11 | |
| `effect/globalErrorInEffectCatch` | 6 | 4 | 4 | |
| `effect/globalErrorInEffectFailure` | 12 | 9 | 9 | |
| `effect/globalTimers` | 3 | 3 | 3 | |
| `effect/lazyEffect` | 2 | 2 | 2 | Track 2 |
| `effect/leakingRequirements` | 1 | 1 | 1 | Track 2 |
| `effect/multipleEffectProvide` | 6 | 2 | 2 | rise fixed, §3 |
| `effect/preferTypedSchemaDecoder` | 1 | 1 | 1 | |
| `effect/processEnv` | 11 | 5 | 5 | |
| `effect/schemaNumber` | 1 | 1 | 1 | Track 2 |
| `effect/unknownInEffectCatch` | 1 | 0 | 0 | **promoted → `error`**; off ledger |
| `effect/unnecessaryFailYieldableError` | 2 | 0 | 0 | **promoted → `error`**; off ledger |
| `eslint/complexity` | 7 | 23 | 0 | **promoted → `error`**; off ledger |
| `eslint/default-case` | 2 | 8 | 2 | |
| `eslint/max-depth` | 18 | 14 | 14 | |
| `eslint/max-lines` | 2 | 2 | 2 | lane:R forever |
| `eslint/max-lines-per-function` | 77 | 75 | 75 | lane:R forever |
| `eslint/max-params` | 2 | 2 | 2 | lane:R forever |
| `eslint/no-await-in-loop` | 7 | 7 | 7 | |
| `eslint/no-console` | 6 | 9 | 0 | **promoted → `error`**; off ledger |
| `eslint/no-eq-null` | 1 | 3 | 0 | **promoted → `error`**; off ledger |
| `eslint/no-shadow` | 4 | 12 | 4 | |
| `import/no-duplicates` | 21 | 7 | 7 | rise fixed, §3 |
| `node/no-process-env` | 3 | 0 | 0 | promoted by d1; off ledger |
| `oxc/no-accumulating-spread` | 2 | 2 | 2 | |
| `oxc/no-map-spread` | 15 | 14 | 14 | d2 §7e recommends rejecting the rule |
| `promise/always-return` | 0 | 7 | 0 | promoted by d2; off ledger |
| `react-hooks/rules-of-hooks` | 0 | 3 | 0 | promoted by d2; off ledger |
| `react/no-array-index-key` | 0 | 7 | 0 | promoted by d2; off ledger |
| `react/no-did-update-set-state` | 0 | 2 | 0 | promoted by d2; off ledger |
| `react/only-export-components` | 0 | 7 | 0 | promoted by d2; off ledger |
| `typescript/await-thenable` | 5 | 1 | 0 | **promoted → `error`**; off ledger |
| `typescript/consistent-return` | 3 | 20 | 3 | |
| `typescript/consistent-type-imports` | 1 | 8 | 0 | **promoted → `error`**; off ledger |
| `typescript/no-base-to-string` | 2 | 2 | 1 | |
| `typescript/no-confusing-non-null-assertion` | 2 | 2 | 2 | |
| `typescript/no-explicit-any` | 1 | 7 | 1 | |
| `typescript/no-floating-promises` | 1 | 0 | 0 | promoted by d1; off ledger |
| `typescript/no-import-type-side-effects` | 9 | 2 | 1 | |
| `typescript/no-non-null-assertion` | 636 | 601 | 592 | src `error`, tests lane:R (Q1) |
| `typescript/no-redundant-type-constituents` | 2 | 6 | 2 | |
| `typescript/no-unnecessary-boolean-literal-compare` | 1 | 2 | 0 | **promoted → `error`**; off ledger |
| `typescript/no-unnecessary-condition` | 65 | 51 | 50 | |
| `typescript/no-unnecessary-type-arguments` | 4 | 2 | 2 | |
| `typescript/no-unnecessary-type-assertion` | 28 | 116 | 0 | **promoted → `error`**; off ledger |
| `typescript/no-unnecessary-type-conversion` | 19 | 21 | 0 | **promoted → `error`**; off ledger |
| `typescript/no-unsafe-type-assertion` | 143 | 143 | 143 | |
| `typescript/require-array-sort-compare` | 1 | 3 | 1 | |
| `typescript/require-await` | 1 | 73 | 0 | **promoted → `error`**; off ledger |
| `typescript/restrict-template-expressions` | 2 | 0 | 0 | promoted by d1; off ledger |
| `typescript/strict-boolean-expressions` | 346 | 273 | 272 | |
| `typescript/triple-slash-reference` | 1 | 1 | 1 | |
| `unicorn/consistent-function-scoping` | 15 | 15 | 15 | lane:R forever |
| `unicorn/no-array-reverse` | 2 | 1 | 0 | **promoted → `error`**; off ledger |
| `unicorn/no-array-sort` | 58 | 61 | 0 | **promoted → `error`**; off ledger |
| `unicorn/no-new-array` | 0 | 2 | 0 | promoted by d2; off ledger |
| `unicorn/no-useless-spread` | 0 | 2 | 0 | promoted by d2; off ledger |
| `unicorn/prefer-add-event-listener` | 0 | 4 | 0 | promoted by d2; off ledger |
| _advisory_ `typescript/no-deprecated` | 12 | 104 | 12 | never gates |

## 5. Gate and suite results

| Gate | Result |
|---|---|
| `intent/gate.sh session claude-code` | exit 0 (`SOFT_MISSING: shellcheck actionlint nvfetcher`) |
| `bun install --frozen-lockfile` | clean against the auto-merged `bun.lock` |
| `bun run verify` (`NX_SKIP_NX_CACHE=true`) | **exit 0** — typecheck 17/17, oxlint **0 errors**, `vp fmt --check` clean on 423 files, knip advisory-only, harness **39 pass / 0 fail** |
| `bun test packages` | **354 pass / 1 fail** — the fail is `packages/store-jsonl/tests/benchmark.test.ts` "load + query well under 1s", the wave's documented known-red at base |
| `bun run test:ui` | **630 pass / 0 fail** across 89 files |
| `.githooks/pre-commit` (on the merge commit) | ran and passed — gate, `docs.check` clean (2 views), kb asset-backup ownership, release pins, full `verify` |
| `docs.materialize` from the repo root | ran; `docs/kb/rules.md` and `docs/kb/todos.md` **byte-identical**, nothing to commit |

The three load-sensitive tests named in d2 §7m
(`palette-index.test.ts` 50k perf bar, `editor-behavior.test.tsx` transient
prune, `test-kit/tests/dst.test.ts` byte-identical replay) all **passed** on
this run — no sibling worktree was building concurrently.

`.kb/nodes.jsonl` was not touched (`docs.materialize` produced no change).

## 6. Needs owner

Carried forward unchanged from d1 §6 and d2 §7 — nothing in this wave closes
any of them. Two are worth re-reading now that both drains are on one branch:

- **d2 §7j is resolved by this merge.** `eslint/complexity` is now `error`
  globally: backend 0 (d1's SLAP extractions), ui 0 (d2's 23 disables, each
  paired with a `#gap` node). The four recurring shapes d2 named in its §5 are
  still the real debt.
- **d2 §7i is still open.** `typescript/consistent-type-assertions` is `error`
  at default options; the plan's `objectLiteralTypeAssertions: "never"` still
  fails `packages/operations/src/session.ts:56`. d1 did not add it.
- **d2 §7h is still open.** `eslint/max-nested-callbacks` stays `warn`; at the
  plan's `["error", 4]` it fails `packages/cli/src/cli.ts` (5 levels).
- **d3's handover items** (`ExtensionTemplate` has no `title`/`description`;
  `render.view` as a *core* action when every template is extension policy;
  the ratchet having no lane for legitimately-new code) are unaffected.
- **`effect/asyncFunction` (303)** remains the ratchet's sharpest edge: any new
  `async` test callback fails `harness` with no honest path but a re-snapshot.

## 7. Gaps as node ids

None minted. This wave writes no nodes; `docs.materialize` produced no
`.kb/nodes.jsonl` change. Node `01M1M08VXGJ5RTQJ3AJNK12G79` (the template-seam
gap d3 closes) was already flipped on the Track 1 branch at `6d05ad4`.

## 8. Commits

| Commit | Subject |
|---|---|
| `2d874a3` | `Merge branch 'feature/d1-drain-backend' into kb-wave/2026-09-03` |
| _(this file)_ | `docs: i1-integrate-d1 wave report` |
