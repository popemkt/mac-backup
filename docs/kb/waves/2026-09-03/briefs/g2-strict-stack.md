# g2-strict-stack — the tightest, most-checked configuration kb can hold

Wave `g2` of `docs/kb/waves/2026-09-03/plan.md`. Depends on `w1` (workspace,
tsgolint binary, effect rc). Produces the config, the gates, and the harness;
`d1`/`d2` do the code drains it schedules.

**Layout note (revision 2):** `w1` restructures `tools/kb` into
`packages/<name>` (plan D11, `briefs/w1-workspace.md`). Read every path below
through that lens: `src/**` → the backend packages, `ui/src/**` → `packages/ui`,
`tests/**` → per-package tests, `harness/` → `packages/harness`. The final
config is **plan Appendix B** (authoritative); §2 here explains the tiers.
`w1` already ships harness checks `boundaries`, `public-surface`,
`version-authored-once`, `workspace-shape`; the alias-map check (§5 #7) is
obsolete because `@kb/*` are real packages. Complexity in ui follows plan D12
(`error` + pinpoint disable + `#gap`), not the ratchet.

Inputs: `reports/recon-refrepo.md` (§1, §3, §4.7, §10), `reports/recon-kb.md`
Part A, `reports/recon-effect.md` §2, `reports/measurements.md`,
`reports/oxlintrc.candidate.json`.

## 0. The one-paragraph shape

One `tsconfig.base.json` owns compiler strictness and both packages extend it
declaring only their delta. One `.oxlintrc.json` owns lint, type-aware, with
three oxlint categories at `error` and every cherry-picked rule at `error`
except a named ratchet lane whose per-rule counts are frozen in a generated
baseline and may only fall. One formatter config. One `knip.json` that sees
exports. One `harness/` directory of `bun test` files asserting *repo shape*.
One `verify` script that pre-commit and CI both run. Nothing has a second home.

## 1. TypeScript — strictness contract

### 1.1 Files

- `tools/kb/tsconfig.base.json` — **new**, the contract. Only strictness and
  safety flags. No `target`/`module`/`moduleResolution`/`lib`/`jsx`/`paths`/
  `types`/`include` (harness rule 3 below rejects them).
- `tools/kb/tsconfig.json` — `extends: "./tsconfig.base.json"` + its delta
  (`module: Preserve`, `moduleResolution: bundler`, `types: ["bun"]`,
  `allowImportingTsExtensions`, `include`, `exclude: ["ui"]`, the `plugins`
  block from §3).
- `tools/kb/ui/tsconfig.json` — `extends: "../tsconfig.base.json"` + delta
  (`jsx`, DOM `lib`, `paths` for `@kb/*`, `include`). Loses every flag the base
  owns.

### 1.2 Flags in the base (all `true` unless stated)

| Flag | measured cost | note |
|---|---|---|
| `strict` | 0 | |
| `noUncheckedIndexedAccess` | ui 2 | |
| `noImplicitOverride` | ui 6 | |
| `noFallthroughCasesInSwitch` | 0 | |
| `verbatimModuleSyntax` | 0 | |
| `exactOptionalPropertyTypes` | 17 + 31 | `d1`/`d2` drain; `KbNode.order` → declared in `KbNodeSchema` (coordinates with `p1`) |
| `noUnusedLocals`, `noUnusedParameters` | 2 + 1 | `_`-prefix convention for intentional |
| `noImplicitReturns` | 0 | |
| `allowUnreachableCode: false`, `allowUnusedLabels: false` | unmeasured, expect 0 | |
| `noUncheckedSideEffectImports` | unmeasured | ui `import "./index.css"` needs a `declare module "*.css"` — one file, `ui/src/css.d.ts`; if that grows into a fight, record and drop the flag |
| `erasableSyntaxOnly` | unmeasured | Bun strips, never transpiles enums/namespaces; if any `enum` exists the flag finds it |
| `forceConsistentCasingInFileNames` | 0 | default true; state it |
| `useUnknownInCatchVariables` | 0 | implied by strict; state it |
| `skipLibCheck: true` | — | **kept**, recorded exception: 3 upstream lib errors (`@modelcontextprotocol/sdk`, `effect` ×2). Re-measure after rc.112. Compensation in §5 harness check 10 for kb's own `src/types/datascript.d.ts` shim |
| `noPropertyAccessFromIndexSignature` | 114 + 239 | **rejected** (plan D9). Record in the DESIGN.md contract table as a rejected row with the count |

### 1.3 Contract is data, not prose

`tools/kb/DESIGN.md` gets a `### Compiler strictness contract` section
containing a markdown table `| flag | value | status |`. Harness check 3
parses that table and asserts `tsconfig.base.json` matches it exactly (refrepo
`.harness/tsconfig-strictness.test.mts`). Rejected flags appear as `status:
rejected` rows so the harness can also assert they are *absent*.

## 2. oxlint — one config, cherry-picked, cranked

Start from `reports/oxlintrc.candidate.json` (already measured) and apply the
edits below. Output is `tools/kb/.oxlintrc.json`; `ui` has none.

### 2.1 Plugins and categories

```jsonc
"plugins": ["eslint", "typescript", "react", "import", "unicorn", "oxc", "promise", "node"],
"categories": { "correctness": "error", "suspicious": "error", "perf": "error" }
```

`perf` is on (Effect's own repo does the same). `pedantic`, `style`,
`restriction`, `nursery` stay off as categories — refrepo measured 4,099 /
37,580 / 11,375 findings for the first three; individual rules are picked from
them below. Record the rule: **categories are cherry-picked, never adopted
wholesale.**

### 2.2 Rule tiers

**Tier E — `error` now (count today ≤ 21 or 0, drained inside `g2` or the
first `d` commit):**

`import/no-cycle` (uncapped — drop `maxDepth: 8`), `import/no-duplicates`,
`import/no-self-import`, `import/no-empty-named-blocks`,
`typescript/ban-ts-comment` (`ts-expect-error: allow-with-description`),
`typescript/no-explicit-any`, `typescript/consistent-type-imports`
(`inline-type-imports`), `typescript/no-import-type-side-effects`,
`typescript/consistent-type-assertions` (`as`, object literals never),
`typescript/no-redundant-type-constituents`, `typescript/no-base-to-string`,
`typescript/await-thenable`, `typescript/no-floating-promises`,
`typescript/no-misused-promises`, `typescript/switch-exhaustiveness-check`,
`typescript/restrict-template-expressions`, `typescript/no-implied-eval`,
`typescript/no-misused-spread`, `typescript/require-array-sort-compare`,
`typescript/unbound-method`, `typescript/no-unnecessary-type-constraint`,
`typescript/no-useless-empty-export`, `typescript/no-unnecessary-type-conversion`,
`typescript/no-unnecessary-type-arguments`, `typescript/consistent-return`,
`typescript/no-unused-vars` (`^_` ignore), `promise/always-return`,
`promise/catch-or-return`, `eslint/no-var`, `eslint/prefer-const`,
`eslint/no-eq-null`, `eslint/default-case`, `eslint/no-shadow`,
`eslint/no-useless-constructor`, `eslint/no-unneeded-ternary`,
`eslint/no-useless-concat`, `eslint/max-depth` (5),
`eslint/max-nested-callbacks` (4), `oxc/no-accumulating-spread`,
`oxc/no-map-spread`, `oxc/misrefactored-assign-op`,
`unicorn/no-abusive-eslint-disable`, `unicorn/prefer-array-flat-map`,
`unicorn/no-accessor-recursion`, `node/no-process-env`, `eslint/no-console`,
`react/exhaustive-deps`, `react/rules-of-hooks`, `react/button-has-type`,
`react/no-danger`, `react/no-array-index-key`, `react/no-children-prop`,
`react/only-export-components` (`allowConstantExport`),
`react/react-in-jsx-scope: off`.

**Tier R — ratchet lane (`warn` + frozen baseline; promoted to `error` by
`d1`/`d2` when a scope hits 0):**

| rule | today | promote when |
|---|---|---|
| `typescript/no-non-null-assertion` | 232 + 400 | `src/**` and `ui/src/**` non-test at 0 (plan Q1 decides tests) |
| `typescript/no-unsafe-type-assertion` | 156 + 191 | 0 in non-test (tests: off, as refrepo) |
| `typescript/no-unnecessary-type-assertion` | 28 + 227 | autofix pass → immediately |
| `typescript/strict-boolean-expressions` | 79 + 262 | 0 |
| `typescript/no-unnecessary-condition` | 10 + 86 | 0 |
| `typescript/require-await` | 8 + 73 | 0 |
| `unicorn/no-array-sort` | 48 + 61 | 0 |
| `eslint/complexity` (20) | 6 + 23 | backend `error` in `g2` after `d1`'s six fixes; ui via `d2` (plan Q2) |
| `eslint/max-lines-per-function` (120), `eslint/max-params` (5), `eslint/max-lines` (900) | 24 / 0 / 1 + 62 / 2 / 2 | **never** — size sensors stay `warn` by design (L2 soft tier); the ratchet alone holds them |
| `unicorn/consistent-function-scoping` | 6 + 8 | never (style) |

**Tier A — advisory lane (`warn`, reported, never blocks, no promotion):**
`typescript/no-deprecated` (2 + 102; non-deterministic against dependency
versions). `d2` triages the ui hits.

**Rejected rules (record with count in the config header comment):**
`typescript/array-type` (408 + 450, style), `eslint/no-underscore-dangle`
(2 + 9, style), `import/no-named-as-default-member` (180, all `fc.*`
fast-check namespace calls — false-positive class), `eslint/no-await-in-loop`
in tests (17 of 19 are sequential fixture setup; keep `error` in `src`).

### 2.3 Overrides (each carries a one-line reason in the file)

1. `ui/src/**` — existing `no-restricted-imports` fence (`@kb/*` seam). Keep.
2. `src/foundation/**`, `src/operations/**` — existing layer fence. **Widen the
   regex**: today it only matches `^(?:\.\./)+(surface|operations|render)/`; a
   same-directory or aliased import slips through. Match any path segment.
3. `src/foundation/**` — additionally forbid importing `../operations/` (leaf
   means leaf; today the regex covers surface/operations/render from foundation
   already; verify with a red test).
4. `src/bin/**`, `src/surface/cli.ts` output writer only — `no-console: off`.
   `server.ts`, `registry.ts`, `mcp.ts` must route through one logging seam
   (find the existing one; if none, `foundation/log.ts` is the *only* new
   module `g2` may add, and `d1` migrates the 6 sites).
5. `src/surface/ui/paths.ts` — `node/no-process-env: off`. It is already the
   config seam (6 of 9 hits). `src/bin/*` reads go through it.
6. `**/*.test.ts`, `**/*.test.tsx`, `tests/**`, `harness/**` —
   `no-console: off`, `no-unsafe-type-assertion: off`,
   `consistent-type-assertions: off`, `no-await-in-loop: off`,
   `import/no-named-as-default-member: off`. **Not** `no-floating-promises`
   (a floating Effect in a test is a silently-passing test).
7. `**/*.css` — empty rules block (keeps the glob valid). Keep.

Must not: a second severity tier for the same rule in the same scope ("a second
quality stack wearing a disguise"). The lane mechanism is the *only* way a rule
is soft.

### 2.4 Invocation — one scope map

```jsonc
"lint":        "oxlint --config .oxlintrc.json --type-aware index.ts src extensions-bundled tests harness ui/src",
"lint:fix":    "… --fix"
```

Delete `lint:all` and the `vp lint`/`vp check` scripts: `vp lint` ignores
`ui/**` and does not read `.oxlintrc.json`, which is the two-linters hazard
recon-kb A.7 names. `vite.config.ts` keeps only `build`/`test`/`dev` concerns;
its `lint` block goes. (`vp check` was lint-only anyway.) If `vp` insists on
linting during `vp test`, set its lint to the same config file path — one
config, two invokers is acceptable; two configs is not.

Harness check 1 parses the `lint` script string to derive the scope set —
never a restated list.

## 3. `@effect/tsgo` — Effect diagnostics through the existing `tsc` gate

- `w1` adds `@effect/tsgo` as a dev dep. `g2` wires it:
  `"prepare": "effect-tsgo patch"` (confirm the exact `--oxlint` variant with
  `effect-tsgo patch --help`; the devtools page documents it for repos running
  `oxlint-tsgolint`, which kb now does).
- `tsconfig.json` (backend only — ui has no Effect) `compilerOptions.plugins`:

```jsonc
[{
  "name": "@effect/language-service",
  "includeSuggestionsInTsc": true,
  "ignoreEffectSuggestionsInTscExitCode": false,
  "diagnosticSeverity": {
    // correctness — error
    "floatingEffect": "error", "missingEffectError": "error",
    "missingEffectContext": "error", "missingLayerContext": "error",
    "missingStarInYieldEffectGen": "error", "missingReturnYieldStar": "error",
    "outdatedApi": "error", "classSelfMismatch": "error",
    "duplicatePackage": "error", "anyUnknownInErrorContext": "error",
    "unsupportedServiceAccessors": "error",
    // anti-patterns — error
    "tryCatchInEffectGen": "error", "runEffectInsideEffect": "error",
    "leakingRequirements": "error", "unknownInEffectCatch": "error",
    "globalErrorInEffectCatch": "error", "globalErrorInEffectFailure": "error",
    "multipleEffectProvide": "error", "scopeInLayerEffect": "error",
    "lazyEffect": "error", "schemaNumber": "error",
    "unnecessaryFailYieldableError": "error",
    // Effect-native preferences — warning first; promote per the same
    // zero-count rule as the lint ratchet (harness check 2 reads tsgo output too)
    "processEnv": "warning", "globalDate": "warning", "globalConsole": "warning",
    "globalRandom": "warning", "globalTimers": "warning", "asyncFunction": "warning",
    // style — off; fights house style / vp fmt
    "missedPipeableOpportunity": "off", "effectFnOpportunity": "off",
    "importFromBarrel": "off"
  }
}]
```

Measured today: 0 errors, 25 warnings (12 `globalErrorInEffectFailure`,
6 `globalErrorInEffectCatch`, 6 `multipleEffectProvide`, 1
`unknownInEffectCatch`), 13 messages. Setting the anti-pattern group to `error`
makes `tsc --noEmit` red on 25 sites. **`g2` lands them at `warning` in the
ratchet lane; `d1` fixes and promotes** — same mechanism as lint.
`lazyEffect` (2) and `leakingRequirements` (1) hit the `Store` port; `p1`
fixes those and `d1` must not.

`globalDate`/`globalRandom` overlap `tests/dst/guard.test.ts` (the grep for
`Date.now`/`Math.random`). When both are `error`, the grep guard is the
duplicate — delete it and keep the typed diagnostic (Rule 1). Record the swap
in the DST test file's header.

## 4. Formatter and knip

- `vp fmt --check` becomes a gate. Add `tools/kb/.oxfmtrc.json` (or the vp
  equivalent — confirm the filename `vp fmt --init` writes) so defaults are
  pinned, not implied. One commit runs `vp fmt` over both packages (77 + 180
  files) *before* the gate is added; that commit is format-only.
- `knip` script → `knip --include files,dependencies,exports,types,nsExports,nsTypes,duplicates`.
  Today: 113 unused exports, 33 types, 1 duplicate, 1 unused devDep, 4 hints.
  `g2` applies the 4 config hints (drop `storybook` from `ignoreDependencies`,
  the two redundant entries; decide `.css`) and deletes `index.ts` (the dead
  "kb M1" stub that is also a knip entry and hides dead code behind it). The
  113/33 drain is `d1`/`d2`. Until then `knip` runs in the advisory lane.
- Bring `tests/**` into knip's `project` so test-only helpers are seen.

## 5. `harness/` — repo-shape tests

`tools/kb/harness/*.test.ts`, run by `bun test harness`, dependency-free (read
`package.json`, tsconfigs, the lint config, `DESIGN.md`, git output; never
import `src/`). Wired into `verify`. Each ships with red-then-green evidence.

| # | check | asserts |
|---|---|---|
| 1 | `lint-scope-coverage` | every tracked **and untracked-not-ignored** `*.ts/*.tsx` under `tools/kb` falls in exactly one lint scope derived by parsing the `lint` script; every scope path exists; `EXCLUDED_BY_DECISION` (expect: `ui/dist`, `ui/storybook-static`, generated `ext-sdk`) is stale-checked |
| 2 | `lint-warn-ratchet` | reads `harness/lint-warn-baseline.json` `{ lanes: { blocking: {rules}, advisory: {rules} } }` (generated by `bun run harness:snapshot`, **no timestamp**); runs the linter in JSON mode; per rule: rise → fail; drop → pass and print "re-snapshot"; **`warn` rule at count 0 → fail: "promote to error"**; rule firing but absent from baseline → treated as rise from 0. Also ingests `effect-tsgo diagnostics --format json` warnings into the same ledger |
| 3 | `tsconfig-contract` | `tsconfig.base.json` equals the DESIGN.md table (present flags, rejected flags absent); both package tsconfigs `extends` it and redeclare none of its keys; base carries no `target`/`module`/`moduleResolution`/`lib`/`jsx`/`paths`/`types` |
| 4 | `skip-pairing` | every `test.skip`/`describe.skip`/`it.skip`/`.todo` has `// GAP [[<id>]]` within 3 lines; `BASELINED_SKIPS` empty and stale-checked |
| 5 | `gap-markers-resolve` | every `GAP [[id]]` in `src ui/src tests extensions-bundled` names an existing `.kb/nodes.jsonl` node tagged `#gap` (parse the JSONL directly; do not import kb) |
| 6 | `no-conflict-markers` | no tracked file under `tools/kb` contains `<<<<<<<`, `>>>>>>>`, `|||||||`, or a corroborated `=======` |
| 7 | `alias-map-single-source` | the `@kb/*` alias set is declared once (`ui/kb-seam.json`) and `ui/tsconfig.json` `paths`, `ui/vite.config.ts`, `knip.json`, `ui/.storybook/main.ts` all resolve to it (the three JS/TS consumers `import` it; the test checks tsconfig equality). Today `.storybook/main.ts` is already missing `@kb/queries` — the red case |
| 8 | `scripts-chain-exists` | every `bun run X`/`npm run X` referenced from a `package.json` script exists in that package; no `prepare`/`postinstall` compiles anything |
| 9 | `seam-barrels-named` | every `@kb/*` seam module and every `src/*/index.ts` barrel uses named exports, never `export * from` (`export * as ns` allowed) |
| 10 | `datascript-shim-typechecks` | `src/types/datascript.d.ts` compiles with `skipLibCheck: false` in an isolated `tsc` invocation over the shim + `foundation/query/datascript.ts` |
| 11 | `version-authored-once` | every dependency declared by both `tools/kb` and `ui` is `catalog:`; literals are in `OFF_CATALOG_BY_DECISION` with a reason; no `latest`/`*`/`next` anywhere; `bunfig` has `minimumReleaseAge ≥ 4320` |
| 12 | `gitignore-covers-derived` | `.kb/cache/`, `nodes.jsonl.lock`, `*.bak`, `reports/mutation`, `.stryker-tmp` are gitignored (the lock file is **not** today — recon-kb B.1) |

Do not port: `pnpm dedupe --check`, catalog↔lockfile provenance (bun.lock shape
differs), pipeline-copies, submodules, agents-sync, nx-inputs.

## 6. `verify` — one gate, two invokers

```jsonc
"typecheck":        "tsc --noEmit && (cd ui && tsc --noEmit)",
"lint":             "oxlint … --type-aware …",          // §2.4
"fmt:check":        "vp fmt --check index.ts src extensions-bundled tests harness && (cd ui && vp fmt --check src)",
"knip":             "knip --include …",
"harness":          "bun test harness",
"harness:snapshot": "bun harness/snapshot.ts",
"verify":           "bun run typecheck && bun run lint && bun run fmt:check && bun run knip && bun run harness",
"test":             "bun test src tests extensions-bundled",
"test:ui":          "cd ui && vp test",
"test:dst":         "bun tests/dst/run-many.ts 25"
```

- `.githooks/pre-commit`: when any staged path matches `^tools/kb/`, run
  `bun run verify` in `tools/kb` (replacing the two bare `tsc` calls). Keep the
  "warn and skip if `node_modules/effect` missing" posture. Measure wall time
  in the report; if > 90 s, split `knip` out to CI only and record why.
- `.github/workflows/validate.yml` job `kb`: `bun install --frozen-lockfile`
  (once, root) → `bun run verify` → `bun run test` → `bun run test:ui` →
  `bun run test:dst` → `docs-check` → `check-kb-assets-backup.sh`. Drop the
  separate ui `tsc` step (now inside `verify`). Stryker stays weekly, advisory,
  no thresholds (delete the `break: 60` — refrepo's reasoning: a
  non-deterministic merge-blocker erodes trust; kb's own workflow header says
  the score is unreproducible).
- `bun test` today recurses into `ui/**` minus a bunfig ignore list; with
  explicit paths in `test` that list becomes dead — delete it from
  `bunfig.toml` (Rule 1: one mechanism decides what `bun test` runs).

## 7. Acceptance

- `bun run verify` green on the `g2` branch with the ratchet baseline
  committed; every Tier E rule at `error` with 0 findings; every Tier R rule
  at `warn` with its count frozen; advisory lane reported.
- Each of the 12 harness checks has a recorded red run (a deliberate breaking
  edit, reverted) in `reports/g2-strict-stack.md`.
- `oxlint --type-aware` runs in both packages; wall time recorded (refrepo:
  +61 %; kb expected seconds).
- `tsc --noEmit` includes Effect diagnostics (prove with one deliberate
  `Effect.fail(new Error())` that fails the build, then revert).
- `DESIGN.md` §Compiler strictness contract table exists and check 3 reads it.
- No second lint config, formatter config, alias map, or clock guard exists
  when the wave ends.

## 8. Report

`reports/g2-strict-stack.md`: shipped / cut (with `#gap` node ids) /
shared-file touches / wall-clock of `verify` / the red-then-green table /
counts before and after per rule.

## Addendum (2026-09-03, coordinator) — boundary feedback in the editor

Owner asked why boundaries are harness-only and not ESLint. Decision: still no
second linter. Recommended shape, in priority order:

1. **Generated oxlint overrides from the tag matrix.** Imports are now
   `@kb/<pkg>` package names, so `eslint/no-restricted-imports` per package
   glob can express "an `application`-tagged package may not import an
   `infrastructure`-tagged package". The harness *generates* the override
   block from each package's `nx.tags` + the constraint matrix and asserts the
   committed `.oxlintrc.json` equals the generated one (config is data; the
   matrix stays single-sourced). Result: inline squiggle + one linter.
2. If oxlint override granularity cannot express the matrix, keep the
   harness check over `nx graph --file` as the sole enforcement and file a
   `#gap` (via report, not kb — `.kb/nodes.jsonl` is owner data) saying so.

ESLint (`@nx/enforce-module-boundaries`) stays rejected unless both fail.
