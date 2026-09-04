# Measurements — 2026-09-03 (current tree, read-only runs)

Every number below was produced on this checkout with CLI flags only; no repo
file was modified. Re-run before each wave lands; numbers are point-in-time.

Tooling used: `tools/kb/node_modules/.bin/tsc` 7.0.2, `oxlint` 1.76.0 with
`oxlint-tsgolint` (from a scratch install — see "tsgolint gap"),
`@effect/tsgo` (scratch install), `vp fmt` 0.2.8, `knip` 6.32.2.

## 1. tsc — cost of each candidate strictness flag

Baseline: both packages 0 errors.

| Flag | backend (`tools/kb`) | ui (`tools/kb/ui`) | verdict |
|---|---|---|---|
| `noUncheckedIndexedAccess` | already on | **2** | on |
| `noImplicitOverride` | already on | **6** | on |
| `noFallthroughCasesInSwitch` | already on | 0 | on |
| `verbatimModuleSyntax` | already on | 0 | on |
| `exactOptionalPropertyTypes` | **17** | **31** | on (drain) |
| `noUnusedLocals` + `noUnusedParameters` | **2** | **1** | on |
| `noImplicitReturns` | 0 | 0 | on |
| `noPropertyAccessFromIndexSignature` | **114** | **239** | **reject** — style, no soundness gain; `Record<NodeId, …>` is the model |
| `skipLibCheck: false` | **3**, all upstream (`@modelcontextprotocol/sdk` `HeadersInit`, `effect` `TextDecoderOptions`, `effect` `SchemaAST.Sentinel`) | not run | keep `true`; re-measure after `effect@rc.112`; guard our own `.d.ts` shim separately |
| `noUncheckedSideEffectImports`, `erasableSyntaxOnly`, `allowUnreachableCode:false`, `allowUnusedLabels:false` | not measured | not measured | measure in-wave; expected ~0 except ui css side-effect imports |

## 2. oxlint — candidate strict config (`reports/oxlintrc.candidate.json`)

Backend scope = `index.ts src extensions-bundled tests`; ui scope = `ui/src`.
Type-aware runs succeeded only from a scratch install (see §4).

### 2a. High-count rules (drive the ratchet-lane decision)

| Rule | backend | ui | classification |
|---|---|---|---|
| `typescript/array-type` (generic) | 408 | 450 | **reject rule** — pure style, Effect-library convention, no bug story |
| `typescript/no-non-null-assertion` | 232 | 400 | real debt — `error` in `src/**`, ratchet in tests |
| `import/no-named-as-default-member` | 180 | 0 | **false-positive class** — all `fc.*` fast-check namespace calls in property tests; off |
| `typescript/strict-boolean-expressions` | 79 | 262 | ratchet lane → promote at 0 |
| `typescript/no-unsafe-type-assertion` | 156 | 191 | ratchet lane (tests off, as refrepo) |
| `typescript/no-unnecessary-type-assertion` | 28 | 227 | autofixable → `error` after one fix pass |
| `typescript/no-deprecated` | 2 | 102 | advisory lane (non-deterministic against deps) |
| `typescript/no-unnecessary-condition` | 10 | 86 | ratchet → `error` |
| `typescript/require-await` | 8 | 73 | ratchet → `error` |
| `unicorn/no-array-sort` (prefer `toSorted`) | 48 | 61 | real mutation hazard; ratchet → `error` |
| `eslint/complexity` (20) | **6** | **23** | backend `error` now; ui ratchet + drain wave |
| `eslint/max-lines-per-function` (120) | 24 warn | 62 warn | size sensor — warn + ratchet, never error |
| `eslint/no-console` | 19 | 18 | `error`; allowed only in `src/bin/**` + the one CLI output seam |
| `eslint/no-await-in-loop` (perf cat.) | 19 (17 in tests) | 5 | on in `src`, off in tests |

### 2b. Everything else (all ≤ 21, cheap to drain to 0)

backend: no-unnecessary-type-conversion 19, consistent-type-imports 12,
node/no-process-env 9 (6 in `surface/ui/paths.ts` = the config seam),
consistent-type-assertions 7, oxc/no-map-spread 6, await-thenable 5,
no-shadow 4, no-unnecessary-type-arguments 4, consistent-return 3,
import/no-duplicates 3, prefer-const 3, restrict-template-expressions 2,
no-redundant-type-constituents 2, no-base-to-string 2, no-accumulating-spread 2,
max-nested-callbacks 2, default-case 2, no-underscore-dangle 2 (reject rule),
require-array-sort-compare 1, no-floating-promises **1**, no-explicit-any 1,
no-eq-null 1, no-import-type-side-effects 1.

ui: consistent-return 17, react/no-children-prop 13, no-unused-vars 11,
consistent-type-imports 9, oxc/no-map-spread 9, no-underscore-dangle 9 (reject),
no-shadow 8, react/no-array-index-key 7, promise/always-return 7,
no-explicit-any 6, default-case 6, react/only-export-components 5,
unicorn/prefer-add-event-listener 4, no-redundant-type-constituents 4,
no-extraneous-class 4, import/no-named-as-default 4, react-hooks/rules-of-hooks
**3**, no-useless-escape 3, no-eq-null 3, max-depth 2, and singles.

`typescript/switch-exhaustiveness-check` and `typescript/no-misused-promises`:
**0 hits in both packages** — turn on at `error` for free.

### 2c. Complexity offenders (the 29 functions > 20)

backend (6): `foundation/tx-validation.ts txIntegrityError`,
`operations/docs/templates.ts todos`, `foundation/ontology.ts resolveInto`,
`foundation/resolve.ts resolveFieldId`, `surface/format.ts formatSuccess`,
`tests/dst/harness.ts nextAction`.

ui (23): `canvas-page.tsx` ×4, `view-config.ts` ×3, `field-value.tsx` ×2,
`selection-keymap.ts`, `use-selection-keymap.ts`, `node-command-palette.tsx`,
`node-block.tsx`, `graph-page.tsx`, `bullet.tsx`, `graph-lens.ts`,
`field-row.tsx`, `sigma-graph.tsx`, `use-node-keydown.ts`, `run-command.ts`,
`md-inline.ts`, `cluster-graph.tsx`, `graph-layouts.ts`.

## 3. `@effect/tsgo diagnostics` on `tools/kb/tsconfig.json`

99 files, all detected as Effect v4. **0 errors, 25 warnings, 13 messages.**

| Diagnostic | count | where |
|---|---|---|
| `globalErrorInEffectFailure` | 12 | `surface/cli.ts` ×9, `registry.ts`, `surface/mcp.ts`, `surface/root.ts` |
| `globalErrorInEffectCatch` | 6 | `surface/cli.ts` ×4, `registry.ts` ×2 |
| `multipleEffectProvide` | 6 | `context.ts` ×2, `surface/ui/http.ts`, `surface/ui/server.ts`, `tests/persistence.test.ts` ×2 |
| `unknownInEffectCatch` | 1 | `surface/cli.ts:139` |
| `lazyEffect` (message) | 2 | **`storage/store.ts:27` + `services.ts:69`** — the `loadEffect()` zero-arg method on the Store port |
| `leakingRequirements` (message) | 1 | `services.ts:69` — `KbStore` methods require `FileSystem` from every caller |
| `schemaNumber` (message) | 1 | `storage/node-schema.ts:24` — `Schema.Number` admits NaN/Infinity; JSON cannot carry them |
| `unnecessaryFailYieldableError` | 2 | `services.ts:147`, `write-lock.ts:119` |
| `catchToOrElseSucceed` | 4 | `docs/views.ts`, `surface/mcp.ts`, `surface/root.ts`, `extensions-bundled/docs.ts` |
| `catchToIgnore`, `effectMapVoid`, `preferTypedSchemaDecoder` | 1 each | |

The two `lazyEffect` + `leakingRequirements` hits land exactly on the
persistence seam the p1 brief redesigns — fix them there, once.

## 4. tsgolint gap (blocks type-aware lint today)

`oxlint --type-aware` fails in `tools/kb` and `tools/kb/ui`:

```
Error: Cannot find module '@oxlint-tsgolint/darwin-arm64/tsgolint'
```

`oxlint-tsgolint` is present (via `vite-plus`) but its platform optional
dependency is not installed in either `node_modules`. A fresh `bun add -d
oxlint-tsgolint` in a scratch directory installs `@oxlint-tsgolint/darwin-arm64`
fine, so this is an install/lockfile state issue, not a Bun limitation. Root
cause to establish in `w1` before `g2` can enable `--type-aware`.

## 5. Formatter drift

`vp fmt --check` with default config (no config file found):

| package | files | unformatted |
|---|---|---|
| backend | 99 | **77** |
| ui | 232 | **180** |

One mechanical `vp fmt` commit, then gate.

## 6. knip with exports included

`knip --include files,dependencies,exports,types,nsExports,nsTypes,duplicates`:

- unused devDependencies: 1
- **unused exports: 113** (ui/src/lib 34, src/foundation 29, src/operations 21, src/surface 6, ui/src/components 5, src/render 4, …)
- unused exported types: 33
- duplicate exports: 1 (`NodeTextHost|NodeContent` in `ui/src/components/outline/node-content.tsx`)
- config hints: 4 (`storybook` no longer needs ignoring; two redundant entry patterns; `.css` excluded)

Current `knip` script (`--include files,dependencies`) sees none of this.

## 7. Persistence baseline (from `reports/recon-persistence.md` §1, same machine)

| stage @50k nodes | ms |
|---|---|
| read + `JSON.parse` | 34 |
| Effect Schema decode (per-line `Effect.gen`+`try`+`mapError`) | ~170 (84 if batched) |
| `nodesToDatoms` + `d.init_db` | ~411 |
| `d.serializable` + stringify (snapshot write) | ~113 |
| `JSON.parse` + `d.from_serializable` (snapshot restore) | **~100** |
| `bun:sqlite` read-all same docs | 28 (vs 34 JSONL) |
| `kb set` at 50k (full reload + rewrite) | ~310 |
| cold CLI at 231 nodes | 190 (≈150 is `import "effect"` + `datascript`) |

Scale constants (measured on this machine, Bun 1.3.14):

| | real graph (231 nodes) | synthetic 50k (tag + status + one mention each) |
|---|---|---|
| datoms per node | **7.2** | **8.3** |
| heap per datom | — | **~380 B** (158 MB for 415 k datoms) |

⇒ 1 M datoms ≈ 120–140 k nodes ≈ 400 MB in-process. Path queries: transitive
closure over `:node/mentions` via a recursive rule returned 24 nodes in 17 ms
on the real graph; bounded depth needs one rule body per depth; path-as-value
and shortest path are not expressible in datalog.

`tests/benchmark.test.ts` **fails today**: 2267 ms vs its `< 1000` assertion.
`datascript` npm 1.7.8 and 1.8.1: `storage`/`store`/`restore` exports are
`undefined`; `serializable`/`from_serializable`/`db_with`/`listen` present.
