# b6-tighten-backend — backend ledger and Effect lane to zero

Wave `b6` of [plan.md](../plan.md). Harness: claude-code. Branch
`feature/b6-tighten-backend`, seven commits on top of `5a052f7` (`c1`).
Scope: every package under `tools/kb/packages/` except `ui`.

## 0. Headline

The Effect lane is drained. Every rule the brief named reached 0 except two
that are owner decisions, and both are named in §7 with what closing them
costs.

| Lane | before (`c1`) | after |
|---|---:|---:|
| `effect/asyncFunction` (`src/`) | 68 | **0** |
| `effect/globalDate` | 5 | **0** |
| `effect/globalErrorInEffectFailure` | 5 | **0** |
| `effect/globalErrorInEffectCatch` | 1 | **0** |
| `effect/globalTimers` | 1 | **0** |
| `effect/lazyEffect` | 2 | **0** |
| `effect/leakingRequirements` | 1 | **0** |
| `effect/schemaNumber` | 1 | **0** |
| `effect/globalConsole` | 3 | 1 (§7) |
| `effect/anyUnknownInErrorContext` | 1 | 1 (§7) |
| `typescript/no-unsafe-type-assertion` (non-ui) | 49 | 4 (§7) |
| `unicorn/consistent-function-scoping` (non-ui) | 7 | **0** |
| `eslint/no-await-in-loop` (non-ui) | 3 | **0** |
| `eslint/max-nested-callbacks` | 1 | **0** |
| `typescript/no-deprecated` (mcp, advisory) | 2 | 2 (§7) |
| `eslint/max-lines-per-function` (non-ui) | 3 | 3 (§7) |

Ledger: **21 → 12 blocking rules**; no rule rose. Nine rules are at 0 and
ready for the coordinator's promotion pass (§6).

## 1. Commits

| sha | what |
|---|---|
| `3b89aa7` | retire `expectDefined` for `present` |
| `59b6932` | the CLI command table is the one Effect edge |
| `656ce57` | the `kb ui` server is Effect end to end |
| `9d8189a` | drain the Effect lane in runtime, operations, mcp, ext-sdk |
| `731e506` | time comes from the `Clock`, including the canvas stamp |
| `e54b394` | the store port stops leaking its platform |
| `6317919` | parse at the boundaries instead of asserting |

Each commit is `bun run verify` green and `bun test packages` green; the
pre-commit hook (gate, `docs.check`, asset ownership, release pins, full
`verify`) ran and passed on all seven.

## 2. The edges and services introduced

**One promise edge per package, and it is the framework's own boundary.**

| Package | Edge | Was |
|---|---|---|
| `@kb/cli` | `cliAction` / `kbAction` build the Commander action callback: one `Effect.runPromise`, `handleCliError` folded in with `Effect.catchCause`, and the one place `process.exitCode` is set | 28 `async function` handlers, each awaiting `withCtx` and assigning `process.exitCode`; `ext sdk` had grown a second `runPromise` |
| `@kb/server` | `serveUi` (Bun.serve callbacks), `watchNodesFile`, `makeReloadDebounce`, `onTerminationSignal` — plain functions beside an Effect `startUi` that provides `bunFileSystemLayer` at each public entry | `startUi`, `startDevServer`, `startProductionUi`, `runUiCli` were `async` and each opened its own `runPromise` |
| `@kb/mcp` | `bindMcpHandlers` — the SDK request handlers, which must return promises | four `async` handlers inline in an `async createMcpServer` |
| `@kb/runtime` | `openKb` / `reload` / `persist` / `invoke` stay Promise-shaped by design (that is their whole purpose) but are no longer `async` | same four, `async`, with `invoke` unwrapping an `Exit` by hand |
| `@kb/ext-sdk` | the generator script provides its own platform layer at `import.meta.main` | `async` all the way down |

**Services now read where a global was read.**

- `Clock`: the write lock's spin deadline, the canvas `updatedAt` stamp, and
  `nowIso` (which runs `currentIso` through the default runtime, so the sync
  seed default and the Effect path read one time source).
- `DateTime`: `isoFromMillis`, the store's single ISO formatting point.
- `Effect.sleep` in a fiber: the server's fs-watch debounce. Each event
  interrupts the pending sleep and forks a new one, and the server scope
  cancels an in-flight reload on stop — which is the redesign `b1` §7 said
  was needed rather than a substitution.
- `FileSystem`: `@kb/server`'s build lifecycle, `@kb/operations`'
  `saved-query` and `extension-loader`, and `@kb/ext-sdk`'s writer. Three
  modules stopped importing `node:fs/promises`; the package's own service was
  already there.
- **Not** a service: `durable-replace`'s temp-file name. It read `Date.now()`
  for uniqueness, which collides when two commits land in the same
  millisecond; a per-process sequence is unique without reading a clock the
  write path has no reason to read.

**Errors are tagged.** `UsageError` (`@kb/operations`) and `RootNotFoundError`
(`@kb/runtime`) are `Schema.TaggedError`s (`Kb/UsageError`,
`Kb/RootNotFoundError`), so raising one is `yield* new UsageError({ message })`
and `handleCliError` still maps both to exit 2 by `instanceof`. New tagged
errors: `UiBuildError` (`@kb/server`), `ExtSdkEmitError` (`@kb/ext-sdk`).

**One place owns "name a schema failure".** `schemaFailure` and `isZodError`
moved from `@kb/runtime`'s registry into `@kb/model`'s schema seam, next to
`parseActionInput` — which is now an Effect that already fails typed. The
registry's private `parseInputEffect` is gone.

## 3. Rule 1 in the CLI: the table, not the handlers

Converting 28 handlers one at a time would have been 28 copies of the same
edit. The abstraction was the command table, so that is what changed:

- `cliAction(body)` and `kbAction(body)` are the only Commander callbacks.
  `Effect.suspend` wraps the body so a plan built eagerly (a bad `--prop`)
  fails *inside* the Effect, where it failed before.
- A command's arguments arrive as one tuple, so no body takes more than three
  parameters — the naive spread pushed `eslint/max-params` from 2 to 4 and
  this is what kept the count flat.
- The option bag is read through Commander's own typed accessor
  (`opts<T>()` / `optsWithGlobals<T>()`), not a cast over `any`: five
  `no-unsafe-type-assertion` sites in `cli.ts` disappear, and the
  `.option()`/`.argument()` declarations are the schema they were always
  implicitly trusted to be.
- `handleCliError`'s four near-identical JSON/stderr branches collapse into
  one `reportFailure`, and `max-nested-callbacks` in `ext list` drops from 5
  to 4 as a consequence of the shallower table rather than by editing that
  handler.

## 4. `expectDefined` retirement

| | |
|---|---|
| Deleted | `packages/test-kit/src/expect-defined.ts`, its barrel export, `packages/test-kit/tests/expect-defined.test.ts` |
| Added | `packages/model/tests/present.test.ts` (the deleted test, moved to where the surviving helper lives) |
| Rewritten | 205 call sites across 28 test files → `present(value, "expected <expr>")`; nested calls collapse to one description of the outermost missing value |
| Dependencies | `@kb/render-tests` gains a `@kb/model` devDependency (`layer:test-support` may reach `domain`); `@kb/harness` keeps the relative import it already used, now `../../model/src/present.ts` |
| Comments fixed | `present.ts`'s docstring, and `packages/harness/src/constraints.ts`'s comment, which named a helper that no longer exists |

The messages are derived from the expression they guard
(`present(byId.get(x), "expected byId.get(x)")`). That is mechanical and
reviewable, and a failure now says which lookup came back empty.

## 5. Behaviour changes

Everything else in this wave is behaviour-neutral. These are the exceptions,
all under the brief's §0:

1. **`--type` is parsed, not assumed.** `parsePropType` in `@kb/operations`
   states the prop-type vocabulary once, for both `--type <t>` and the
   `field:type=value` fragment. An unknown `--type` is now a usage error
   (exit 2, `invalid prop type: <t>`) instead of silently falling back to
   value inference — which is what the `field:type=` spelling already did.
2. **A `num` prop must be finite.** `NumPropValue.v` is `Schema.Finite`. NaN
   and ±Infinity serialise to `null` and fail to load back, so such a write
   is now rejected at the boundary instead of writing a line the loader
   cannot read.
3. **The canvas stamp replays.** `ext-canvas` stamped `updatedAt` from the
   wall clock, which the determinism-seam guard recorded as a KNOWN BYPASS: a
   seeded replay of a canvas write diverged. It now takes one
   `yield* currentIso` per transaction. The guard's exemption is deleted,
   which is what keeps it closed.
4. **`withNodesWriteLock` is gone.** A sync twin of
   `acquireNodesWriteLockEffect` that no code path called. Deleted rather
   than converted (its two `Date.now()` reads went with it).
5. **Temp-file names.** `durable-replace` uses a per-process sequence instead
   of a millisecond stamp — unique where the stamp could collide.
6. **`EffectStore` no longer requires `FileSystem`.** `loadEffect` is a value
   rather than a nullary function, and `JsonlStore` provides
   `bunFileSystemLayer` itself. No caller ever injected a different
   FileSystem; every one passed `bunFileSystemLayer`.
7. **The registry cache holds an `Effect.cached` value** rather than a cached
   Promise. Concurrent callers still share one build (that is what
   `Effect.cached` is for), so extension-load warnings are still printed once.
8. **`Predicate.isObject` replaces hand-rolled record guards.** It excludes
   arrays, where `asRecord` admitted them; an array-shaped extension
   contribution is now reported as "contribution is not an object", which is
   what it is.
9. **`Cause.hasInterruptsOnly` re-interrupts.** `@kb/mcp`'s CallTool edge used
   to re-raise the cause through a cast; it now uses `Effect.interrupt`. Same
   observable outcome (the promise rejects on cancellation rather than
   reporting `isError`), one less assertion.
10. **`parseActionJson`'s dead branch.** Its `SyntaxError` ternary produced the
    same `invalid JSON: <message>` string on both sides. Collapsed.
11. **`ext list --json` and `ext sdk --json`** emit the same fields as before
    (checked field by field, not by spreading the registry).

## 6. Ledger — before / after

`before` = `packages/harness/lint-warn-baseline.json` at `5a052f7`. `after` =
`6317919`, regenerated with `bun run harness:snapshot` (never hand-edited).
Rules absent from `after` are at 0.

| Rule | before | after | note |
|---|---:|---:|---|
| `effect/anyUnknownInErrorContext` | 1 | 1 | §7 |
| `effect/asyncFunction` | 68 | — | **0 — promote** |
| `effect/globalConsole` | 3 | 1 | scope change + §7 |
| `effect/globalDate` | 5 | — | **0 — promote** |
| `effect/globalErrorInEffectCatch` | 1 | — | **0 — promote** |
| `effect/globalErrorInEffectFailure` | 5 | — | **0 — promote** |
| `effect/globalTimers` | 1 | — | **0 — promote** |
| `effect/lazyEffect` | 2 | — | **0 — promote** |
| `effect/leakingRequirements` | 1 | — | **0 — promote** |
| `effect/schemaNumber` | 1 | — | **0 — promote** |
| `eslint/max-depth` | 2 | 2 | `@kb/ui` |
| `eslint/max-lines` | 2 | 2 | `@kb/ui` |
| `eslint/max-lines-per-function` | 40 | 40 | 37 `@kb/ui`; §7 for the 3 |
| `eslint/max-nested-callbacks` | 1 | — | **0 — promote** |
| `eslint/max-params` | 2 | 2 | `@kb/ui` |
| `eslint/no-await-in-loop` | 7 | 4 | remaining 4 all `@kb/ui` |
| `typescript/no-non-null-assertion` | 391 | 391 | `@kb/ui` |
| `typescript/no-unnecessary-condition` | 31 | 31 | 30 `@kb/ui`, 1 harness test |
| `typescript/no-unsafe-type-assertion` | 127 | 82 | 78 `@kb/ui`, 4 §7 |
| `typescript/strict-boolean-expressions` | 200 | 200 | `@kb/ui` |
| `unicorn/consistent-function-scoping` | 15 | 8 | remaining 8 all `@kb/ui` |
| _advisory_ `typescript/no-deprecated` | 12 | 12 | 10 `@kb/ui`, 2 mcp (§7) |

Nine rules reached 0. `effect/*` promotions are severity flips in
`tsconfig.bun.json`, the oxlint one in `.oxlintrc.json`; the brief reserved
both files for the coordinator, so this wave changed neither.

### Ratchet scope

`countsTowardRatchet` now skips a `scope:tooling` package's `src/` in the
suggestion lane, read from the tag the package already carries — `@kb/harness`
prints with `console` because it is a script, and that is now said once, in
the collector, rather than in a second list. `ratchet-scope` has the red case;
`DESIGN.md` "Ratchet scope" says it in prose.

Consequence for `effect/globalConsole`: 3 sites exist, 1 counted. See §7.

## 7. Needs owner

| Site(s) | Why this wave did not close it |
|---|---|
| `effect/globalConsole` — `ext-sdk/src/generate.ts:149` | The brief said to treat it like `@kb/harness`, whose `console` the collector now scopes out by its `scope:tooling` tag. `@kb/ext-sdk` is `scope:backend`: the package ships a runtime surface *and* a generator script. The two honest closures are (a) move `generate.ts` out of `src/` — which needs its `no-console` glob in `.oxlintrc.json` updated, and changes the "Regenerate:" path baked into the committed `sdk-dts.text.ts`; or (b) accept it as a permanent allowlist entry the way `runtime/src/output.ts` is. Both edit `.oxlintrc.json`, which the brief reserved. |
| `effect/anyUnknownInErrorContext` — `runtime/src/registry.ts:307` | This is `ActionEffectHandler`'s `unknown` error channel at the point the registry composes a handler. Moving the `Effect.mapError(mapHandlerError)` earlier (to registration, or into the loader) does not help: the rule fires on any Effect *value* carrying `unknown` in `E`, so it would move with the wrapper. The only closure is narrowing the declared channel of `ActionEffectHandler`, which is the extension SDK's public contract and is baked into the generated `sdk-dts.text.ts` — third-party handlers would need a closed error vocabulary, and anything outside it would become a defect instead of a failure. Same conclusion as `b1` §7, now with the reason the cheap fix does not work. |
| `typescript/no-unsafe-type-assertion` (4) — `operations/src/extension-loader.ts:138,146`; `runtime/src/registry.ts:307,316` | One boundary, twice. A runtime check can verify that `effect`/`handler`/`template` is a function; it cannot verify the function's *signature*. So `actionProblem`/`templateProblem` validate everything checkable and the contribution is then asserted to `ExtensionAction`/`ExtensionTemplate`; and `ActionEffectHandler`'s `(input: never)` — the standard TS encoding for "any concrete input type is assignable" — forces `parsed as never` at the call. Closing either needs the same public contract decision as the row above. Left counted in the ratchet rather than disabled at the site: the rule is in the ratchet lane, and per `CLAUDE.md` a rule uses one mechanism, not both. |
| `typescript/no-deprecated` (2) — `mcp/src/mcp.ts:209,281` | The SDK deprecates `Server` in favour of `McpServer`, and says "only use `Server` for advanced use cases". kb's use *is* that case: it advertises a tool list built from the registry manifest, with raw JSON Schema per tool. `McpServer.registerTool` takes a Zod raw shape and static registration, which the manifest cannot produce (`ActionDefinition.inputSchema` is already JSON Schema by the time it reaches mcp). Migrating means restructuring what the manifest carries. Advisory lane — it never gates. |
| `eslint/max-lines-per-function` (3) — `model/src/seed.ts`, `model/src/example.ts`, `cli/src/cli.ts` | The brief said "only if a step falls out on its own". None did: the two seed builders are flat literal tables, and `buildProgram` is the command table this wave made *more* declarative. Splitting any of them would trade one long readable list for two halves and a name. |
| `typescript/no-unnecessary-condition` (1) — `harness/tests/boundaries-oxlint.test.ts:33` | Not in this wave's target list; untouched. |
| `exactOptionalPropertyTypes` backend (~17) | Carried from `d1` §6 unchanged; touches the data model. |
| `packages/ui/**` | `b4`/`b5` own it; not touched (verified: no file under `packages/ui/` differs from `5a052f7`). |

## 8. Shared-file touches

| File | Change | Why |
|---|---|---|
| `tools/kb/packages/harness/lint-warn-baseline.json` | regenerated with `bun run harness:snapshot` (never hand-edited) | §6 |
| `tools/kb/packages/harness/src/snapshot.ts` | suggestion lane skips `scope:tooling` `src/` | §6 |
| `tools/kb/packages/harness/src/constraints.ts` | comment no longer names `expectDefined` | §4 |
| `tools/kb/packages/harness/tests/{ratchet-scope,determinism-seam}.test.ts` | new red case; two exemptions deleted | §6, §5 |
| `tools/kb/DESIGN.md` | "Ratchet scope" states the tooling rule | §6 |
| `tools/kb/.oxlintrc.json`, `tools/kb/tsconfig.bun.json` | **not touched** | coordinator promotes |
| `tools/kb/bun.lock` | 7 lines: `@kb/model` → render-tests, `@effect/platform-bun` + `effect` → ext-sdk, `effect` → render-tests, `@kb/ext-docs` → cli | §2, §5 |
| `.kb/nodes.jsonl` | **not touched** | owner data |

New workspace edges, each allowed by the `layer`/`scope` matrix and confirmed
by the `boundaries` harness check: `render-tests → model` (test-support →
domain), `cli → ext-docs` (app → extension, for the action's own
`outputSchema`). `@kb/ext-sdk` gains `effect` and — in its generator script
only — `@effect/platform-bun`: `layer:contract` may not reach
`@kb/store-jsonl`'s persistence boundary, and a generator script is its own
composition root.

## 9. Suite results

| Gate | Result |
|---|---|
| `intent/gate.sh session claude-code` | exit 0 (`SOFT_MISSING: shellcheck actionlint nvfetcher`) |
| `bun install --frozen-lockfile` | clean (`Checked 646 installs across 872 packages (no changes)`) |
| `bun run verify` | **exit 0** — typecheck 17/17, oxlint 0 errors, `vp fmt --check` clean, knip advisory-only (all remaining findings `@kb/ui`), harness **45 pass / 0 fail** |
| `bun test packages` | **363 pass / 0 fail**, 54 files |
| `bun run test:ui` | **630 pass / 0 fail**, 89 files — run because `@kb/canvas` and `@kb/contracts` are ui dependencies and both changed |
| `.githooks/pre-commit` | ran and passed on all seven commits |

`store-jsonl/tests/benchmark.test.ts` and `test-kit/tests/dst.test.ts` are
load-sensitive (documented in `b1` §8) and failed once each on a run with a
sibling worktree building concurrently; both pass on a quiet box, and the
final runs above are quiet-box runs.

## 10. Gaps as node ids

None minted. Every deferral is in §7 with its file, line and reason.
