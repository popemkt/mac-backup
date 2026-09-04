# d1-drain-backend — report

Wave `d1` of `docs/kb-waves/2026-09-03/plan.md` §d1 + Appendix A.5.
Harness: cursor (grok 4.6), worktree stacked on `g2` (`cd6a5b9`, branch `feature/g2-strict-stack`).
This wave's branch: `feature/d1-drain-backend`.
Depends on `w1` (package layout) and `g2` (strict stack + ratchet baseline).
Scope: backend packages under `tools/kb/packages` except `ui`. `.kb/nodes.jsonl` was not touched.

Final `bun run verify` (tools/kb, `NX_SKIP_NX_CACHE=true`): **green**
(typecheck + lint + fmt:check + knip + harness 36 pass / 0 fail).
Backend `bun test` (excluding `@kb/ui`): **347 pass**; the known-red-at-base 50k benchmark is not this wave's.

---

## 1. Shipped

Lane-R rules in §d1 order, drained to **0 in backend** (src, and tests where the rule hit 0 there too), then promoted to `error` in the matching oxlint scope, then re-snapshotted.

| # | Rule | Promotion scope | After (be_src / be_test / ui) |
|---|---|---|---|
| 1 | `promise/always-return` | backend-all → error | 0 / 0 / 7 |
| 1 | `typescript/no-floating-promises` | global → error | 0 / 0 / 0 |
| 2 | `typescript/no-unnecessary-type-assertion` | backend-all → error | 0 / 0 / 116 |
| 3 | `eslint/no-console` | backend-all → error; seam allowlist | 0 / 0 / 9 |
| 4 | `node/no-process-env` | global → error; seam allowlist | 0 / 0 / 0 |
| 5 | `typescript/consistent-type-imports` | backend-all → error | 0 / 0 / 8 |
| 6 | `typescript/no-non-null-assertion` | backend-**src** → error (Q1: tests stay warn) | 0 / 201 / 400 |
| 7 | `typescript/strict-boolean-expressions` | backend-src → error | 0 / 28 / 245 |
| 8 | `typescript/no-unnecessary-condition` | backend-src → error | 0 / 2 / 49 |
| 9 | `typescript/require-await` | backend-all → error | 0 / 0 / 73 |
| 10 | `unicorn/no-array-sort` | backend-all → error | 0 / 0 / 61 |
| 11 | `eslint/complexity` | backend-all → error | 0 / 0 / 23 |
| — | `typescript/restrict-template-expressions` | global → error (hit 0 workspace-wide as a side-effect) | 0 / 0 / 0 |

Workspace ratchet ledger: **64 → 59** blocking rules. No blocking count rose above the g2 baseline. No new warning rules.

### Seams (one mechanism each)

- **Output.** `tools/kb/packages/runtime/src/output.ts` (`writeOut` / `writeErr`). The only backend `console` allowlist entries are this file, `packages/*/src/bin/**`, and `packages/ext-sdk/src/generate.ts`.
- **Config.** `tools/kb/packages/server/src/paths.ts` is the only `process.env` reader (`const PROCESS_ENV = process.env`). `kbDataRoot()` and `childProcessEnv()` are the API; bins and `startDevServer` consume them. oxlint turns `node/no-process-env` off only for this file.
- **Narrowing.** `tools/kb/packages/model/src/present.ts` — `present<T>(value, message)` throws a plain `Error` (not `DomainError`) so `ontology → errors → resolve` does not cycle under `import/no-cycle`. Effect boundaries fold that through `ensureDomainError`.
- **DomainError mapper.** `ensureDomainError` in `packages/model/src/errors.ts`. Preserves an existing `DomainError` / `ResolveError`, and any foreign `Error` whose `.code` is a `DomainError` code (so DocsError / CanvasTxError / legacy extension `.code = "conflict"` keep their receipt codes). One mapper; the duplicate in `store-jsonl` was deleted.
- **Layers.** `reload` / `persist`, the HTTP facade, and server fs-watch use `Effect.provide(kbRuntimeLayer(ctx))`. Dead `jsonlStoreLayer` deleted.

### Complexity (SLAP — named steps, not line-count splits)

The six A.5 backend offenders plus the helpers they forced:

- `formatSuccess` (+ command-shaped helpers) — `packages/cli/src/format.ts`
- `collectLinterWarnings` — `packages/harness/src/snapshot.ts`
- `resolveInto` — `packages/model/src/ontology.ts`
- `resolveFieldId` + `FIELD_ID_ALIASES` — `packages/model/src/resolve.ts`
- `txIntegrityError` (parent/orphan/cycle steps) — `packages/model/src/tx.ts`
- `todos` / `todosByProject` / `todosFlat` — `packages/operations/src/docs/templates.ts`
- `nextAction` — `packages/test-kit/src/harness.ts`
- `invariantViolations` split into `missingChildErrors` / `multipleParentErrors` / `orderingErrors` / `mintedSysErrors` — `packages/test-kit/src/harness.ts`

### tsgo (25 warnings in the brief)

Folded: `globalErrorInEffectFailure` 12→9, `multipleEffectProvide` 6→2, `unknownInEffectCatch` 1→0, `unnecessaryFailYieldableError` 2→0, `anyUnknownInErrorContext` 7→6, `globalErrorInEffectCatch` 6→4, `globalConsole` 23→17, `processEnv` 11→5, `asyncFunction` 312→303.
Left untouched on purpose: `lazyEffect` 2, `leakingRequirements` 1, `schemaNumber` 1 (Store port, Track 2).

### Knip dead exports (deleted, never re-exported)

Un-exported or removed: `removeCanvasNode`, `normalizeShapeKind`, several canvas types that were never imported; `listDefinitions`; `jsonlStoreLayer`; `EXAMPLE_ID_PREFIX`; `LAYERS` / `SCOPES`; `KB_SDK_DTS` re-export from `emit.ts`; `export type { ExtensionAction, ExtensionFailure }` from `registry.ts`; docs.ts re-exports of `ViewSpecSchema` / `templates` / `renderText`. Remaining knip unused exports are all `@kb/ui` (d2).

### Commit coupling (why not one commit per promotion)

Source fixes for every §d1 rule land in the same files. The harness fails if a blocking rule hits 0 and stays `warn`, and oxlint fails if a rule is flipped to `error` before its scope is 0. A per-rule commit series would need interactive `git add -p` across mixed hunks. This wave therefore ships **one** source+promotion+snapshot commit, then the report. The promotions themselves are still scoped (global vs backend-all vs backend-src) rather than a blanket `error`.

---

## 2. Cut

- `exactOptionalPropertyTypes` (backend 17) — on the g2 handover list, **not** in the §d1 order. Not drained.
- Size sensors (`max-lines*`, `max-params`, `consistent-function-scoping`) stay ratchet forever.
- UI drain (`d2`): every leftover count in the table above.
- Store-port tsgo (`lazyEffect` / `leakingRequirements` / `schemaNumber`) — Track 2.

---

## 3. Shared-file touches

| File | Change | Why |
|---|---|---|
| `tools/kb/packages/ui/tsconfig.json` | `lib` `ES2022` → `ES2023` | Backend `.toSorted()` must typecheck when UI `tsc` pulls `@kb/model` / `@kb/query` source. Not a UI drain. |
| `tools/kb/packages/mcp/package.json` + `tools/kb/bun.lock` | `"@kb/model": "workspace:*"` | MCP now imports `ensureDomainError` / `DomainError` from the owning package. |
| `.kb/nodes.jsonl` | **not touched** | Owner data; r2/d2 only. |

---

## 4. Red-then-green evidence

Every promoted rule was shown red on a throwaway `packages/cli/src/_d1_red_proof.ts`, then deleted. Workspace oxlint `--quiet` exit 0 afterwards.

| Rule | Red (oxlint error on the proof file) | Green |
|---|---|---|
| `typescript/no-floating-promises` | `Promises must be awaited` on `Promise.resolve(1)` | scope 0; global `error` |
| `node/no-process-env` | `Disallowed usage of process.env` | scope 0; global `error`; only `paths.ts` off |
| `typescript/restrict-template-expressions` | `Invalid type used in template literal` | workspace 0; global `error` |
| `promise/always-return` | `Each then() should return a value or throw` | be 0; backend-all `error` |
| `typescript/no-unnecessary-type-assertion` | `This assertion is unnecessary` (`x as string`) | be 0; backend-all `error` |
| `eslint/no-console` | `Unexpected console statement` | be 0; backend-all `error` |
| `typescript/consistent-type-imports` | `Use import type` | be 0; backend-all `error` |
| `typescript/require-await` | `Function has no await expression` | be 0; backend-all `error` |
| `unicorn/no-array-sort` | `Use Array#toSorted() instead of Array#sort()` | be 0; backend-all `error` |
| `eslint/complexity` | `function f has a complexity of 25. Maximum allowed is 20` | be 0; backend-all `error` |
| `typescript/no-non-null-assertion` | `Forbidden non-null assertion` on `x!` in src | be src 0; backend-src `error` |
| `typescript/strict-boolean-expressions` | `Unexpected nullable string value in conditional` | be src 0; backend-src `error` |
| `typescript/no-unnecessary-condition` | `This condition will always return the same value` | be src 0; backend-src `error` |
| ratchet | restoring a drained `warn` without snapshot fails `lint-warn-ratchet` (observed while fixing copy-vs-mutate tests) | snapshot matches live counts |

---

## 5. Per-rule before / after (workspace blocking ledger)

Before = g2 `lint-warn-baseline.json` at `cd6a5b9`. After = this wave's snapshot. Only rules that moved, plus the §d1 set.

| Rule | g2 | after | notes |
|---|---:|---:|---|
| `promise/always-return` | 7 | 7 | all remaining are UI |
| `typescript/no-floating-promises` | 1 | 0 | promoted global error; dropped from ledger |
| `typescript/no-unnecessary-type-assertion` | 144 | 116 | be 0 |
| `eslint/no-console` | 15 | 9 | be 0 |
| `node/no-process-env` | 3 | 0 | promoted global error; dropped from ledger |
| `typescript/consistent-type-imports` | 9 | 8 | be 0 |
| `typescript/no-non-null-assertion` | 645 | 601 | be src 0; 201 be tests + 400 UI |
| `typescript/strict-boolean-expressions` | 346 | 273 | be src 0 |
| `typescript/no-unnecessary-condition` | 65 | 51 | be src 0 |
| `typescript/require-await` | 81 | 73 | be 0 |
| `unicorn/no-array-sort` | 119 | 61 | be 0 |
| `eslint/complexity` | 30 | 23 | be 0 (UI 23 remains for d2 disable+GAP) |
| `typescript/restrict-template-expressions` | 2 | 0 | promoted global error |
| `effect/multipleEffectProvide` | 6 | 2 | merged `kbRuntimeLayer` |
| `effect/globalErrorInEffectFailure` | 12 | 9 | mapper |
| `effect/processEnv` | 11 | 5 | one cached read in `paths.ts` |
| `effect/unknownInEffectCatch` | 1 | 0 | dropped from ledger (tsgo-only) |
| `effect/unnecessaryFailYieldableError` | 2 | 0 | dropped from ledger (tsgo-only) |
| `effect/lazyEffect` | 2 | 2 | Track 2 |
| `effect/leakingRequirements` | 1 | 1 | Track 2 |
| `effect/schemaNumber` | 1 | 1 | Track 2 |

No rises vs g2. `oxc/no-map-spread` 15→14: tests that must **copy** nodes keep object spread (Object.assign mutated the seed fixture and changed assertions). Production `example.ts` still uses Object.assign on locally owned nodes in a map that returns those same objects.

---

## 6. Needs owner

| Site | Why this wave did not change it |
|---|---|
| `exactOptionalPropertyTypes` backend (~17, mostly `order: string \| undefined` on `KbNodeSchema`) | g2 recorded it as d1/d2 drain; §d1 order does not include it. Changing it touches the data model. |
| `packages/**/tests/**` `typescript/no-non-null-assertion` (201) | Q1: tests stay ratchet; src is error. |
| `packages/**/tests/**` `strict-boolean-expressions` (28) and `no-unnecessary-condition` (2) | Same split as Q1; promoting tests would be a later drain. |
| `effect/asyncFunction` (303), `effect/globalDate` (11), `effect/globalTimers` (3), remaining `effect/globalConsole` (17), `effect/processEnv` (5) | Effect-native preferences; still lane:R. `processEnv` 5 is the config seam's one cached read plus leftover sites tsgo still counts. |
| `effect/lazyEffect` (2), `effect/leakingRequirements` (1), `effect/schemaNumber` (1) | Store port; Track 2. Brief forbids folding these here. |
| `packages/model/src/present.ts:7` | Throws plain `Error`, not `DomainError`, to break `import/no-cycle` with `errors.ts`. Success path never threw; impossible-path flavour changed. Promoting it to `DomainError` needs an errors/present layout that does not cycle. |
| `DomainError` codes vs `FailureCode.unknown_action` | Mapper can only preserve codes that `DomainError` already names. `unknown_action` is returned as `failed()` at the registry, not thrown. Widening `DomainError` is a public-API change. |
| `@kb/ui` knip unused exports (44 + 16 types + 1 duplicate) | d2. |
| UI `eslint/complexity` 23 | d2 disable+GAP with `#gap` nodes (r2/d2 write `.kb/nodes.jsonl`). |

---

## 7. Gaps as node ids

None written. This wave must not edit `.kb/nodes.jsonl`. Named gaps above are for r2/d2 to mint if they agree.
