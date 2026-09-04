# b1-burndown-backend — report

Burn-down wave `b1` of `docs/kb/waves/2026-09-03/plan.md` (Appendix A.5 / A.7
leftovers after Track 1 integration). Harness: claude (opus), worktree
`b1-burndown-backend`, branch **`feature/b1-burndown-backend`**, child of
`kb-wave/2026-09-03` at `c541b27`.

Scope: backend packages (everything under `tools/kb/packages` except `ui`),
`src` **and** tests. `.kb/nodes.jsonl` was not touched.

Head: **`fd00229`**. `bun run verify`: **exit 0**.
Ratchet ledger: **40 → 21** blocking rules.

| Commit | Subject |
|---|---|
| `e36cb13` | `fix(kb): drain 13 small-count oxlint rules to 0 and promote to error` |
| `2bde5eb` | `fix(kb): drain Effect suggestions through the existing seams` |
| `fd00229` | `feat(kb): scope the Effect suggestion ratchet lane to src/` |
| _(this file)_ | `docs: b1-burndown-backend wave report` |

---

## 1. Target (1) — small-count oxlint rules

All thirteen were **backend-only**; none had ui hits, so nothing was left for
`b3`. All reach 0 workspace-wide and are promoted `warn → error` in
`tools/kb/.oxlintrc.json` (global severity, not a scoped override block —
scoped blocks exist only where a rule is still non-zero somewhere).

| Rule | before | after | sites drained |
|---|---:|---:|---|
| `import/no-duplicates` | 7 | **0** | `cli/src/cli.ts`, `mcp/src/mcp.ts`, `operations/src/actions.ts` ×2, `runtime/src/registry.ts`, `runtime/tests/materialize.test.ts`, `runtime/tests/persistence.test.ts` |
| `eslint/no-shadow` | 4 | **0** | `ext-canvas/src/index.ts`, `server/src/server.ts` ×2, `runtime/tests/ontology.test.ts` |
| `typescript/consistent-return` | 3 | **0** | `operations/src/session.ts`, `server/src/session.ts`, `test-kit/src/harness.ts` |
| `eslint/default-case` | 2 | **0** | `server/src/session.ts`, `test-kit/src/harness.ts` |
| `typescript/no-confusing-non-null-assertion` | 2 | **0** | `harness/tests/workspace-shape.test.ts` ×2 |
| `typescript/no-redundant-type-constituents` | 2 | **0** | `canvas/src/doc.ts`, `store-jsonl/src/jsonl-store.ts` |
| `typescript/no-unnecessary-type-arguments` | 2 | **0** | `mcp/src/mcp.ts` ×2 |
| `oxc/no-accumulating-spread` | 2 | **0** | `model/tests/order.property.test.ts`, `test-kit/src/harness.ts` |
| `typescript/no-base-to-string` | 1 | **0** | `model/src/errors.ts` |
| `typescript/no-explicit-any` | 1 | **0** | `contracts/src/actions.ts` |
| `typescript/no-import-type-side-effects` | 1 | **0** | `runtime/tests/persistence.test.ts` |
| `typescript/require-array-sort-compare` | 1 | **0** | `test-kit/src/harness.ts` |
| `typescript/triple-slash-reference` | 1 | **0** | `query/src/datascript.ts` (seam allowlist — §5) |

Side effect: `typescript/no-non-null-assertion` 592 → 590 (the two `layers[0]!`
/ `scopes[0]!` that `no-confusing-non-null-assertion` flagged became a
destructure). No other rule rose.

### Rule-1 collapses rather than patches

Three of these were duplication, not style, and the fix was to remove the
duplicate:

- **`ActionHandlerEnv` had two homes.** It was *defined* in `@kb/runtime`
  (`registry.ts`) while every member — `KbCtx`, `KbStore`, `TemplateRegistry` —
  lives in `@kb/contracts`. `@kb/contracts` therefore could not name it, and
  `ActionEffectHandler`'s requirement channel was widened to `any` with a
  comment explaining that the width was deliberate. The union now has one home
  in `@kb/contracts`; `@kb/runtime` forwards the name so no consumer import
  changed. With a precise requirement channel, the **15 `as ActionEffectHandler`
  casts** the `any` had forced (12 in `registry.ts`, 2 in `@kb/ext-docs`, 1 in
  `@kb/ext-canvas`) stopped typechecking as necessary and were deleted —
  `no-unnecessary-type-assertion` (already `error`) caught them, which is the
  ratchet working in the other direction.
- **`ensureDomainError` computed the same message twice.** `err instanceof
  Error ? err.message : String(err)` appeared in both branches; hoisting it to
  one binding above the `typeof err === "object"` narrowing removes the
  duplicate *and* the `no-base-to-string` report, because at the hoist point
  `err` is still `unknown`.
- **Exhaustive switches** (`handleMessage`, `nextAction`) grow the repo's
  existing `never` default idiom (`ui/src/components/outline/caret.ts`), which
  answers `default-case` and `consistent-return` with one clause instead of two
  fixes. `handleMessage`'s clause answers with an `error` frame rather than a
  throw, because its docstring promises the method never throws.

`operations/src/session.ts`'s `persistEffect` ends with an explicit
`return undefined;` — the same shape `d2` used for ui's 17 `consistent-return`
sites. It is needed because the function mixes `return yield* domainError(...)`
(required by the CLAUDE.md Effect rule "`return yield*` when raising") with an
implicit end-of-body return, and oxlint cannot see that the raise has type
`never`.

## 2. Target (2) — Effect language-service suggestions

Five diagnostics reach **0 workspace-wide** and are promoted
`suggestion → error` in `tools/kb/tsconfig.bun.json`:

| Diagnostic | before | after | how |
|---|---:|---:|---|
| `effect/catchToOrElseSucceed` | 4 | **0** | `Effect.catch(() => Effect.succeed(x))` → `Effect.orElseSucceed(() => x)` in `ext-docs/src/index.ts`, `mcp/src/mcp.ts`, `operations/src/docs/views.ts`, `runtime/src/root.ts` |
| `effect/multipleEffectProvide` | 2 | **0** | chained `Effect.provide` → one `Layer.mergeAll` in `runtime/tests/persistence.test.ts` ×2 (the shape `d1` established for src and `i1` for `native-actions.test.ts`) |
| `effect/catchToIgnore` | 1 | **0** | `Effect.catchCause(() => Effect.void)` → `Effect.ignoreCause` in `server/src/server.ts` |
| `effect/effectMapVoid` | 1 | **0** | `Effect.map(() => undefined)` → `Effect.asVoid` in `server/src/session.ts` |
| `effect/preferTypedSchemaDecoder` | 1 | **0** | `Schema.decodeUnknownSync` → `Schema.decodeSync` on already-typed input in `contracts/tests/node-schema.test.ts` (the sibling `bad` loop keeps `decodeUnknownSync`, correctly) |

Four more drop through the seams they were supposed to use:

| Diagnostic | before | after | seam |
|---|---:|---:|---|
| `effect/globalConsole` | 17 | 10 (3 in src) | `runtime/src/output.ts`. `cli/src/bin/docs-check.ts` and `docs-materialize.ts` now use `writeOut`/`writeErr`. |
| `effect/globalErrorInEffectFailure` | 9 | 5 | `ensureDomainError` |
| `effect/globalErrorInEffectCatch` | 4 | 1 | `ensureDomainError` |
| `effect/anyUnknownInErrorContext` | 6 | 1 | error channel taken as a type parameter |
| `effect/processEnv` | 5 | 4 | `server/src/paths.ts` stays the only `process.env` reader in workspace code |

Details worth recording:

- **The `no-console` allowlist shrank.** With the two bins on the seam, the
  blanket `packages/*/src/bin/**` and `packages/*/bin/**` globs are gone. The
  allowlist is now the seam files themselves (`runtime/src/output.ts`,
  `ui/src/lib/log.ts`) plus `ext-sdk/src/generate.ts`; `@kb/harness` is already
  covered by the test-scope override. Those two packages **cannot** use the
  seam: the D11 matrix fences `layer:contract` (`@kb/ext-sdk`) and
  `layer:tooling` (`@kb/harness`, "no workspace dependencies at all") off from
  `@kb/runtime`. That is why `globalConsole` still has 3 src hits, not a
  missing effort.
- **`ensureDomainError` at the CLI edges.** Four sites folded a foreign failure
  into a plain `new Error(...)`; they now go through the one mapper. Exit code
  and JSON receipt shape are unchanged (`DomainError` and plain `Error` both
  land on `EXIT_FAILED` with `code: "internal"` in `handleCliError`) with one
  deliberate difference: a foreign failure that already carries a valid
  `FailureCode` (a `DocsError`, a legacy extension `.code = "conflict"`) now
  reports that code instead of `internal` — which is exactly what the mapper
  exists for and how every other edge in the repo already behaves.
- **The render harness dropped an env var.** `KB_HARNESS_PORT` is gone;
  `harness-server.ts` passes the port as an argv and the child inherits the
  environment on its own. Behaviour identical, one fewer config reader.
- **Containment boundaries took a type parameter.** `containToolResult`,
  `runResourceHandler` (`@kb/mcp`) and `withCtx` (`@kb/cli`) declared
  `unknown` in the error channel; they are now generic in `E`. Every caller
  still assigns, and the diagnostic is gone without widening anything.

## 3. Target (3) — what the ratchet measures

`effect/asyncFunction` was 303, and **235 of those are `async` test callbacks**.
The rule could not reach 0, so the ledger's largest number could only move by
re-snapshotting: a rule nothing can satisfy is a rule nothing enforces.

The change is to the measurement, not the tests. oxlint states its test-scope
exemptions once, in `.oxlintrc.json` `overrides`; `@effect/tsgo` has no
per-file severity, so the equivalent scope lives in the collector:

- `packages/harness/src/snapshot.ts` — `countsTowardRatchet` counts
  correctness-severity diagnostics **everywhere** and suggestion-severity ones
  (tsgo emits them as `message`) **only under `packages/*/src/`**. One
  statement; `collectTsgoWarnings` is now a fold over it.
- `packages/harness/tests/ratchet-scope.test.ts` — five assertions, red case
  named in the docstring.
- `tools/kb/DESIGN.md`, new **"Ratchet scope"** subsection under the compiler
  strictness contract — why the two collectors measure different file sets,
  and the consequence stated plainly (below).

| Diagnostic | ledger before | ledger after | src / non-src today |
|---|---:|---:|---|
| `effect/asyncFunction` | 303 | **68** | 68 / 235 |
| `effect/globalConsole` | 17 | **3** | 3 / 7 |
| `effect/globalTimers` | 3 | **1** | 1 / 2 |
| `effect/globalDate` | 11 | **5** | 5 / 6 |
| `effect/processEnv` | 5 | **off ledger** | 0 / 4 |

**The consequence, recorded rather than hidden:** a suggestion rule that
reaches 0 in `src` but still has hits outside it cannot be promoted, because
promotion is a severity flip in `tsconfig.bun.json` and that flip has no file
scope. `effect/processEnv` is the first such rule — it leaves the ledger with
four sites in `packages/render-tests/playwright.config.ts` (Playwright's own
config file). It is listed under Needs owner rather than silently dropped.

Size sensors (`max-lines*`, `max-params`, `max-depth`,
`consistent-function-scoping`) were not touched.

## 4. Red-then-green evidence

**oxlint promotions (13).** One throwaway `packages/model/src/_proof.ts` (plus
a `_proof.d.ts` for the triple-slash case) carried one violating shape per
rule. Before the promotion every one reported at `warning`; after the
promotion in `.oxlintrc.json` every one reported at `error`. The file was then
deleted and `bun run lint` exits 0 with **0 errors** over the workspace.

| Rule | Red output at `error` (abridged) |
|---|---|
| `import/no-duplicates` | `Module './model.ts' is imported more than once in this file` |
| `eslint/no-shadow` | `'text' is already declared in the upper scope.` |
| `eslint/default-case` | `Require \`default\` cases in \`switch\` statements.` |
| `typescript/consistent-return` | `Function 'inconsistent' expected a return value.` |
| `typescript/no-confusing-non-null-assertion` | `Confusing combination of non-null assertion and \`in\` operator like \`a! in b\`…` |
| `typescript/no-redundant-type-constituents` | `'unknown' overrides all other types in this union type.` |
| `typescript/no-unnecessary-type-arguments` | `This is the default value for this type parameter, so it can be omitted.` |
| `oxc/no-accumulating-spread` | `Do not spread accumulators in loops` |
| `typescript/no-base-to-string` | `'err' will use Object's default stringification format ('[object Object]')…` |
| `typescript/no-explicit-any` | `Unexpected \`any\`. Specify a different type.` |
| `typescript/no-import-type-side-effects` | `TypeScript will only remove the inline type specifiers which will leave behind a side effect import at runtime.` |
| `typescript/require-array-sort-compare` | `Require 'compare' argument.` |
| `typescript/triple-slash-reference` | `Do not use a triple slash reference for ./_proof.d.ts, use \`import\` style instead.` |

**tsgo promotions (5).** One throwaway `packages/model/src/_tsgoproof.ts` with
one violating shape per diagnostic. Before the flip, `effect-tsgo diagnostics`
reported all five at `severity: "message"` and `tsc -p packages/model` exited
0 (suggestions are excluded from the tsc exit code). After the flip in
`tsconfig.bun.json` all five reported at `severity: "error"` and
`bun run --filter @kb/model typecheck` **exited 1**. File deleted;
`bun run typecheck` 17/17 green.

| Diagnostic | Red output at `error` (abridged) |
|---|---|
| `effect/multipleEffectProvide` | `This expression chains multiple \`Effect.provide\` calls.` |
| `effect/catchToIgnore` | `` `Effect.ignoreCause` expresses ignored failure more directly than `Effect.catchCause` returning `Effect.void`. `` |
| `effect/catchToOrElseSucceed` | `` `Effect.orElseSucceed` expresses the same recovery more directly than `Effect.catch` followed by `Effect.succeed`. `` |
| `effect/effectMapVoid` | `This expression discards the success value through mapping. \`Effect.asVoid\` represents that form directly.` |
| `effect/preferTypedSchemaDecoder` | `This input is already assignable to the schema's Encoded type. Use \`decodeSync\`…` |

**Ratchet scope check.** `packages/harness/tests/ratchet-scope.test.ts`:
5 pass / 0 fail. Replacing the `src/` test in `countsTowardRatchet` with
`return true` gives **3 pass / 2 fail** — `suggestion outside src/ is not
counted` and `counts group by effect/<name> over the scoped subset`. Restored:
5 pass / 0 fail.

## 5. The one seam allowlist added

`packages/query/src/datascript.ts` keeps its
`/// <reference path="./datascript.d.ts" />` and is allowlisted per-file in
`.oxlintrc.json`, alongside the `paths.ts` (`node/no-process-env`) and
`output.ts` (`no-console`) seams.

The rule's advice ("use `import` style instead") does not apply here, and this
was verified rather than assumed. `datascript.d.ts` is an ambient **script**
(`declare module "datascript"` with no top-level import/export). Both import
forms were tried against a full `bun run typecheck`:

- `import type {} from "./datascript.d.ts"` → `error TS2307` on
  `import * as d from "datascript"` in every dependent package.
- `import "./datascript.d.ts"` → `error TS7016: Could not find a declaration
  file for module 'datascript'` — the import turns the file into a module and
  demotes `declare module` to an augmentation of a module that has no types.

The reference is load-bearing for every package that typechecks `@kb/query`
source, which is what its own docstring says; that docstring now also records
why the allowlist exists.

## 6. Ledger — before / after

`before` = `packages/harness/lint-warn-baseline.json` at `c541b27` (i1's
snapshot, 40 blocking rules). `after` = `fd00229` (21 blocking rules). Rules
absent from `after` are at 0 and promoted, or moved out of the measured scope
(marked).

| Rule | before | after | note |
|---|---:|---:|---|
| `effect/anyUnknownInErrorContext` | 6 | 1 | boundaries genericized; the one left is `ActionEffectHandler`'s own channel |
| `effect/asyncFunction` | 303 | 68 | scope change (§3) |
| `effect/catchToIgnore` | 1 | — | **promoted → `error`** |
| `effect/catchToOrElseSucceed` | 4 | — | **promoted → `error`** |
| `effect/effectMapVoid` | 1 | — | **promoted → `error`** |
| `effect/globalConsole` | 17 | 3 | seam + scope change |
| `effect/globalDate` | 11 | 5 | scope change only — not drained (§7) |
| `effect/globalErrorInEffectCatch` | 4 | 1 | `ensureDomainError` |
| `effect/globalErrorInEffectFailure` | 9 | 5 | `ensureDomainError` |
| `effect/globalTimers` | 3 | 1 | scope change only — not drained (§7) |
| `effect/lazyEffect` | 2 | 2 | Track 2 |
| `effect/leakingRequirements` | 1 | 1 | Track 2 |
| `effect/multipleEffectProvide` | 2 | — | **promoted → `error`** |
| `effect/preferTypedSchemaDecoder` | 1 | — | **promoted → `error`** |
| `effect/processEnv` | 5 | — | 4 sites left, all outside the measured scope (§7) |
| `effect/schemaNumber` | 1 | 1 | Track 2 |
| `eslint/default-case` | 2 | — | **promoted → `error`** |
| `eslint/max-depth` | 14 | 13 | incidental (`ensureDomainError` hoist) |
| `eslint/max-lines` | 2 | 2 | lane:R forever |
| `eslint/max-lines-per-function` | 75 | 75 | lane:R forever |
| `eslint/max-params` | 2 | 2 | lane:R forever |
| `eslint/no-await-in-loop` | 7 | 7 | |
| `eslint/no-shadow` | 4 | — | **promoted → `error`** |
| `import/no-duplicates` | 7 | — | **promoted → `error`** |
| `oxc/no-accumulating-spread` | 2 | — | **promoted → `error`** |
| `oxc/no-map-spread` | 14 | 14 | `d2` §7e recommends rejecting the rule |
| `typescript/consistent-return` | 3 | — | **promoted → `error`** |
| `typescript/no-base-to-string` | 1 | — | **promoted → `error`** |
| `typescript/no-confusing-non-null-assertion` | 2 | — | **promoted → `error`** |
| `typescript/no-explicit-any` | 1 | — | **promoted → `error`** |
| `typescript/no-import-type-side-effects` | 1 | — | **promoted → `error`** |
| `typescript/no-non-null-assertion` | 592 | 590 | `b2` owns the rest |
| `typescript/no-redundant-type-constituents` | 2 | — | **promoted → `error`** |
| `typescript/no-unnecessary-condition` | 50 | 50 | |
| `typescript/no-unnecessary-type-arguments` | 2 | — | **promoted → `error`** |
| `typescript/no-unsafe-type-assertion` | 143 | 143 | |
| `typescript/require-array-sort-compare` | 1 | — | **promoted → `error`** |
| `typescript/strict-boolean-expressions` | 272 | 272 | `b2` owns the rest |
| `typescript/triple-slash-reference` | 1 | — | **promoted → `error`** (one seam allowlist, §5) |
| `unicorn/consistent-function-scoping` | 15 | 15 | lane:R forever |
| _advisory_ `typescript/no-deprecated` | 12 | 12 | never gates |

No rule rose. **40 → 21 blocking rules; 18 promotions (13 oxlint + 5 tsgo).**

## 7. Needs owner

| Site(s) | Why this wave did not change it |
|---|---|
| `effect/globalDate` — `model/src/model.ts:190,198`; `store-jsonl/src/durable-replace.ts:65`; `store-jsonl/src/write-lock.ts:148,151` (+6 in tests) | Excluded by the brief. These are wall-clock stamps (`createdAt`/`updatedAt`, lock staleness, temp-file naming). Moving them to `DateTime`/`Clock` changes what gets written to the store and how lock expiry is decided — a behaviour decision, and `write-lock` staleness is safety-relevant. |
| `effect/globalTimers` — `server/src/server.ts:92` | `setTimeout` is the fs-watch debounce inside a plain closure (`onFsEvent`), not inside an Effect. A `Clock`/`TestClock` substitution needs the debounce to become a fiber with a scope tied to the server lifetime — a redesign of the watch path, not a substitution. The two test sites are the same shape. |
| `effect/processEnv` — `render-tests/playwright.config.ts:7,8` (4) | Playwright's own config file, loaded by Playwright, not by kb. Routing it through `server/src/paths.ts` would make a tool config import `@kb/server`; growing `paths.ts` a generic `envVar(name)` accessor is the alternative. Either is an owner call. Consequence: the rule leaves the ledger without a promotion (§3). |
| `effect/globalErrorInEffectFailure` — `cli/src/cli.ts:234,235,258,497`; `runtime/src/root.ts:27`. `effect/globalErrorInEffectCatch` — `cli/src/cli.ts:230` | Every one is `new UsageError(...)` or `new RootNotFoundError(...)`. `handleCliError` maps both to **`EXIT_USAGE` (2)** while `DomainError` maps to `EXIT_FAILED` (1), so folding them through `ensureDomainError` changes CLI exit codes. The Effect-native fix is to make them `Schema.TaggedError`, which is a real refactor of two error classes plus their `instanceof` checks. |
| `effect/anyUnknownInErrorContext` — `runtime/src/registry.ts:321` | `ActionEffectHandler`'s error channel is `unknown` by design: third-party and bundled extension handlers fail with unrelated types, and `mapHandlerError` is the containment boundary that folds them. Narrowing it means giving extensions a closed error vocabulary — a public contract decision. |
| `effect/globalConsole` — `ext-sdk/src/generate.ts:124`; `harness/src/snapshot.ts:152,156` | Structurally fenced from `runtime/src/output.ts` by the D11 matrix (`layer:contract` and `layer:tooling`). Giving either its own writer would be a second output mechanism. Closing this means either moving the seam below `layer:contract` or accepting these two as permanent allowlist entries. |
| `effect/lazyEffect` (2), `effect/leakingRequirements` (1), `effect/schemaNumber` (1) | Store port; Track 2, excluded by the brief. |
| `exactOptionalPropertyTypes` backend (~17) | Carried from `d1` §6 unchanged; touches the data model. |
| `oxc/no-map-spread` (14) | `d2` §7e recommends rejecting the rule outright. Not this wave's call. |
| `packages/**/tests/**` `no-non-null-assertion` (590 workspace) and `strict-boolean-expressions` (272) | `b2` owns these. |

## 8. Suite results

| Gate | Result |
|---|---|
| `intent/gate.sh session claude-code` | exit 0 (`SOFT_MISSING: shellcheck actionlint nvfetcher`) |
| `bun install --frozen-lockfile` | clean; `bun.lock` unchanged by this wave |
| `bun run verify` | **exit 0** — typecheck 17/17, oxlint **0 errors**, `vp fmt --check` clean, knip advisory-only (all remaining findings are `@kb/ui`), harness **44 pass / 0 fail** (39 + the 5 new `ratchet-scope` assertions) |
| `bun run test` | **355 pass / 0 fail** on an unloaded box (measured after `e36cb13` and after `2bde5eb`) |
| `.githooks/pre-commit` | ran and passed on all three commits — gate, `docs.check` clean (2 views), kb asset-backup ownership, release pins, full `verify` |

Two tests fail when a sibling worktree is building concurrently (load average
was above 20 with ~85 `bun`/`tsc`/`oxlint` processes during the final run), and
both are the ones already named as load-sensitive:
`store-jsonl/tests/benchmark.test.ts` "load + query well under 1s" (the wave's
documented known-red at base) and `test-kit/tests/dst.test.ts` "same seed
replays to a byte-identical store" (`d2` §7m). The DST test passes at
`--timeout 30000` on the same tree, and both passed on the quieter runs above.

`bun run test:ui` was not run: this wave touches no `@kb/ui` file.

## 9. Shared-file touches

| File | Change | Why |
|---|---|---|
| `tools/kb/.oxlintrc.json` | 13 severities `warn → error`; `no-console` allowlist shrunk; one `triple-slash-reference` seam override added | §1, §2, §5 |
| `tools/kb/tsconfig.bun.json` | 5 diagnostics `suggestion → error` | §2 |
| `tools/kb/packages/harness/lint-warn-baseline.json` | regenerated with `bun run harness:snapshot`, never hand-edited | §3, §6 |
| `tools/kb/packages/harness/src/snapshot.ts` | tsgo collector scope | §3 |
| `tools/kb/DESIGN.md` | new "Ratchet scope" subsection | §3 |
| `tools/kb/packages/contracts/src/{actions,index}.ts` | `ActionHandlerEnv` gains its one home; barrel export added | §1 |
| `tools/kb/packages/runtime/src/registry.ts` | forwards `ActionHandlerEnv`; 12 casts deleted | §1 |
| `.kb/nodes.jsonl` | **not touched** | owner data |

## 10. Gaps as node ids

None minted — this wave must not write `.kb/nodes.jsonl`. Every deferral is in
§7 with its file, line and reason, for whoever owns the node file next.
