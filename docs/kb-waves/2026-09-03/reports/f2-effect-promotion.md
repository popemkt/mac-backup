# f2-effect-promotion — the Effect lane becomes promotable

Follow-up wave after `b6`. Harness: claude-code. Branch
`feature/f2-effect-promotion`, eight commits on top of `5813670`
(`kb-wave/2026-09-03` at branch time). Ran in parallel with `f1` (cursor).

Scope as briefed: the tsconfig/severity layer (§1), the extension handler
contract (§2), the `@kb/ext-sdk` generator's `console` (§3), and the
`cursorPosition` → `CaretIntent` gap (§4).

## 1. The tsconfig layer: per-path plugin overrides, not a second preset

**Chosen: option (b).** `@effect/language-service` supports ordered per-file
diagnostic overrides — `overrides: [{ include, exclude, options }]` in the same
plugin block as `diagnosticSeverity` (documented in
`node_modules/@effect/tsgo/README.md` and `schema.json`, and verified to take
effect under `tsc`, not just the LSP). So the whole thing is one entry in the
one authored plugin block:

```jsonc
"diagnosticSeverity": { …, "asyncFunction": "suggestion", … },
"overrides": [
  {
    "include": ["packages/*/src/**/*"],
    "exclude": ["packages/harness/src/**/*"],
    "options": { "diagnosticSeverity": { "asyncFunction": "error", … } }
  }
]
```

**Why not option (a).** A `tsconfig.bun.test.json` preset cannot inherit the
plugin block: `compilerOptions.plugins` is replaced wholesale across `extends`,
not merged. The test preset would therefore have to restate the entire severity
map — two hand-synced copies of one contract, which is the mirror
[Rule 1](../../../../CLAUDE.md) forbids ("bridges over mirrors"). It also cost
15 new `tsconfig.test.json` files, a second `nx typecheck` target per package,
and a harness rule teaching `tsconfig-contract` a two-file shape. Option (b)
keeps one tsconfig per package, one target per project, one authored block, and
`bun run verify` unchanged as a single command.

Glob mechanics worth recording: patterns are matched against workspace-relative
paths and `**` does not match files on its own — `packages/cli/tests/**` matches
nothing, `packages/*/src/**/*` matches. That was found by probing, not by the
docs.

### The promoted list

Fifteen severity flips. Fourteen are `error` under a package's `src/` and stay
`suggestion` outside it; one is `error` everywhere.

| Rule | Before | After | src/ count at flip |
|---|---|---|---:|
| `asyncFunction` | suggestion | **error in `src/`** | 0 (275 outside) |
| `globalConsole` | suggestion | **error in `src/`** | 0 (§3; 7 outside) |
| `globalDate` | suggestion | **error in `src/`** | 0 (6 outside) |
| `globalErrorInEffectCatch` | suggestion | **error in `src/`** | 0 |
| `globalErrorInEffectFailure` | suggestion | **error in `src/`** | 0 |
| `globalRandom` | suggestion | **error in `src/`** | 0 |
| `globalTimers` | suggestion | **error in `src/`** | 0 (2 outside) |
| `lazyEffect` | suggestion | **error in `src/`** | 0 |
| `leakingRequirements` | suggestion | **error in `src/`** | 0 |
| `processEnv` | suggestion | **error in `src/`** | 0 (2 outside) |
| `runEffectInsideEffect` | suggestion | **error in `src/`** | 0 |
| `schemaNumber` | suggestion | **error in `src/`** | 0 |
| `scopeInLayerEffect` | suggestion | **error in `src/`** | 0 |
| `tryCatchInEffectGen` | suggestion | **error in `src/`** | 0 |
| `anyUnknownInErrorContext` | suggestion | **error everywhere** | 0 after §2 |

Two additions to the brief's nine, both deliberate and both measured:

- **`globalConsole`.** §3 moved its last counted site out of `src/`, which drove
  the ratchet's promotion demand. Its two remaining `src/` sites are
  `@kb/harness`'s, which the `scope:tooling` exclude covers, so it promotes.
  This is the case `DESIGN.md` previously recorded as *unpromotable* ("promotion
  is a severity flip and that flip has no file scope"); the flip now has a file
  scope, and that paragraph was rewritten.
- **`globalRandom`, `runEffectInsideEffect`, `scopeInLayerEffect`,
  `tryCatchInEffectGen`.** Measured at 0 across all sixteen tsgo projects,
  `src/` and tests alike. They were never in the ledger because they were
  already at 0 before `b6`, so nothing demanded them — but by the repo's own
  doctrine a rule at 0 left at `suggestion` is a dead seam, and leaving four of
  them behind in the same commit that builds the promotion mechanism would have
  been exactly that. Scoped into the same `src/` override rather than promoted
  globally, so they impose nothing on test files that were never measured.

After this wave **no `effect/*` rule sits at `suggestion` everywhere**: 18 are
`error` globally, 14 are `error` in `src/`, 3 are `off` by recorded decision
(`missedPipeableOpportunity`, `effectFnOpportunity`, `importFromBarrel`), and
the ratchet ledger has zero `effect/*` entries.

### What the harness now holds

Three checks, all with stated red cases.

- **`effect-severity-lanes`** (new, in `tsconfig-contract.test.ts`). Exactly one
  `overrides` entry, so the file scope is stated once. Its `exclude` must equal
  the `src/` globs of every `scope:tooling` package **computed from the nx
  tags** — so the glob list is *checked against* the tag `b6` taught the
  collector to read, not maintained beside it. An override may only promote
  `suggestion` → `error`, never relax. And no rule is both promoted and present
  in the ratchet ledger: a rule is counted or promoted, never both, which is the
  "one mechanism per rule" invariant made machine-checkable.
- **`typecheck-scope`** (new). Every TypeScript file under `tools/kb` falls in
  exactly one package tsconfig `include`. This is the honest (b)-shaped version
  of the brief's "red test for a package missing its test tsconfig": a file
  scope on the severities means nothing unless every file is in a project at
  all. It found one hole immediately — `packages/ui/.storybook` was in no
  project; it typechecks clean, so it is included rather than excused. It also
  made §3 declare `scripts` and `tests` in `@kb/ext-sdk`'s tsconfig.
- **`lint-scope-coverage`** (restructured, behaviour-preserving). It and
  `typecheck-scope` ask the same question of two different scope lists, so the
  loop moved into `@kb/harness`'s new `scopes` reader (`PathScope`,
  `assignToScopes`, `missingScopes`, `typecheckScopes`). Landed as its own
  commit before the addition, per CLAUDE.md's "restructure, then add".

`DESIGN.md` states the rule once, in "Compiler strictness contract" → *Effect
diagnostic severities and their file scope*, including why option (a) was
rejected; the "Ratchet scope" paragraph that claimed promotion has no file scope
now points at it.

## 2. The extension handler contract

Four assertions and an `unknown` error channel at one seam were one fact: the
SDK's exported handler type was looser than what the registry accepts, so every
consumer re-narrowed it by hand.

**`@kb/ext-sdk` now states the contract** (`src/contribution.ts`). A
contribution has two parts and they are treated differently:

- the **declarative** part — `id` (namespacing pattern), `title`,
  `description`, `mode`, `inputSchema`, `outputSchema`, `aliases` — is fully
  checkable at runtime, so it is `Schema`;
- the **behavioural** part is a function, and a function's *signature* is not
  observable at runtime. `typeof x === "function"` is everything any check
  could learn. So `contributedFunction<T>(title)` declares it once via
  `Schema.declare<T>`: the guard verifies what is verifiable and `T` carries
  the rest. That is the module boundary, trusted exactly once, with the comment
  saying so.

An action is a `Schema.Union` of the two handler arms rather than a struct plus
a "one of these is set" filter, so the decoded type *is* `@kb/contracts`'
`ExtensionAction` — no second copy of the shape, and no consumer re-checks the
invariant. `decodeContribution` discriminates (a `template` function is a
template) and returns `Result<ExtensionContribution, string>` with a one-line
message; the loader calls it once and pushes what comes back. Its two
`as unknown as` casts and its 40 lines of hand-rolled `actionProblem` /
`templateProblem` / `aliasesProblem` are gone, and the red cases moved to
`packages/ext-sdk/tests/contribution.test.ts` where the contract lives.

**The error channel is closed.** `ActionEffectHandler` was
`(input: never) => Effect<unknown, unknown, ActionHandlerEnv>`; the `unknown`
in `E` was `effect/anyUnknownInErrorContext` at `registry.ts:307`. It is now

```ts
export type ActionHandlerError = ActionSchemaError | CodedError;
```

where `CodedError` (new, in `@kb/model`'s `failure.ts`, next to `FailureCode`)
is "an error that names its own `FailureCode`" — which is exactly the shape
`receiptFromError` already reads and exactly what `DomainError`, `DocsError` and
`ext-canvas`'s `CanvasTxError` already are. `b6` §7 called this "the only
closure … third-party handlers would need a closed error vocabulary"; the
vocabulary turned out to be one that every existing handler already satisfies,
so nothing had to change at any definition site.

**The registry's two `parsed as never` collapse to one.** `invokeEffect` no
longer branches on `effect` vs `handler` inline; `dispatch(entry, ctx, parsed)`
pairs an action's handler with its input, and the single remaining assertion
lives in `asDeclaredInput` with the reason it cannot be closed here:
`(input: never)` is the standard encoding for "accepts whatever this action's
`inputSchema` produces", and `parseActionInput` returns `unknown` because it is
a runtime seam over Standard Schema and zod. `mapHandlerError` stays, now
documented as the runtime half of the declared channel for handlers authored
outside kb.

Net: **four assertions and one `unknown` error → one assertion, documented, at
the one seam that knows both sides.** Closing that last one means making
`parseActionInput` generic in its schema's output type and typing
`ActionDefinition.effect` by `TIn`, which would move the cast into the decode
boundary where the repo's "parse at the boundaries" doctrine says it belongs —
sized in §7, not attempted here.

New workspace edges, all allowed by the matrix and confirmed by `boundaries`:
`ext-sdk → contracts` and `ext-sdk → model` (contract → contract, contract →
domain), `operations → ext-sdk` (application → contract).

Ownership: `packages/contracts/src/actions.ts` is `f1`'s package. The
coordinator granted it explicitly (msg_896a73e5993d), wider than requested, with
`ActionReceipt` reserved for `f1` — untouched here.

## 3. The ext-sdk generator

`generate.ts` shelled out to `tsc` from inside a `scope:backend` package's
`src/`, so its `console.log` was the last `effect/globalConsole` the ratchet
counted. `src/` is the contract `@kb/ext-sdk` ships; the generator is build
tooling. It moved to `packages/ext-sdk/scripts/generate.ts` and left the barrel.

- `.oxlintrc.json`: the one sanctioned edit — the `no-console` override's path
  follows the file (`src/generate.ts` → `scripts/generate.ts`). No new exception
  list, no widening of the non-`src` lane.
- The freshness assertion moved with it, from `@kb/cli`'s suite to
  `packages/ext-sdk/tests/sdk-dts-fresh.test.ts`: it regenerates from
  `surface.ts` and compares against the committed `sdk-dts.text.ts`, and only
  this package can now reach the generator. `@kb/ext-sdk` gained a `test`
  script; the remaining `@kb/cli` tests keep using `KB_SDK_DTS` from the barrel.
- `typecheck-scope` then required `scripts` and `tests` in the package's
  tsconfig `include` — which is the point of that check.
- `knip.json` entry and the root `gen:ext-sdk` script follow the path.
- `sdk-dts.text.ts` regenerated: its `Regenerate:` header names the new path.
  **This is a user-visible string change** — `kb ext sdk --write` emits a header
  pointing at `scripts/generate.ts`.

## 4. `cursorPosition` → `CaretIntent` (gap 01M1MGT307N4K243CBPJTXNG5X)

The gap read as two live caret mechanisms. It was not one. `NodeTextHost`
declares `cursorPosition?: number` in its props and **never destructures or
reads it**; `activateNode` has always set `pendingCaret` with the canvas
instance key, and `NodeTextHost` places it. So the canvas card was subscribing
to a deprecated store field purely to feed a prop nothing observes. The canvas
has been on `CaretIntent` all along, and `cursorPosition` was a dead seam, not a
parallel path.

Closed in two commits. The first removed the card's subscription and prop pass
(inside this wave's `packages/ui` file set), leaving the field provably unread
with `GAP [[…]]` at both remaining sites. The second — on the coordinator's
explicit go-ahead (msg for §4) — deleted the field from `OutlineState`, its
initial value, its `activateNode` write, and the unread prop.

The cost was 23 one-line deletions in ui test files, because each hand-copies
the store-reset literal and TypeScript's excess-property check makes them
mandatory. That duplication is itself the obstacle and is now
**gap 01M1P63E3Y5KVHV3XMM6TBV2BM** — one shared `resetOutlineStore()` fixture
would have made this a three-line change. Not built here: it is a
`packages/ui`-wide change and wants its own wave.

`bun run test:ui`: 630/630.

## 5. Behaviour changes

Three, all listed:

1. **§4** — `useOutlineStore` no longer has a `cursorPosition` field, and
   `NodeContent` no longer accepts a `cursorPosition` prop. Public store shape
   change. Nothing read either, so no rendered behaviour changes.
2. **§3** — the `Regenerate:` line inside the emitted `.kb/sdk.d.ts` (and in
   `sdk-dts.text.ts`) names `scripts/generate.ts`.
3. **§2** — extension-loader failure messages are now `Schema`-formatted:
   `action greet: Expected "read" | "apply" at ["mode"]` where before it was
   `action greet: mode must be "read" or "apply"`. Same failures, same skip-and-
   warn behaviour, same `{file, error}` shape; only the wording differs. No test
   asserted the old strings. One tolerance was preserved deliberately: a
   contribution carrying `handler: undefined` (from a spread) still counts as
   absent, which is why the optional handler fields use `Schema.optional` rather
   than `Schema.optionalKey`.

## 6. Ledger — before / after

`before` = `packages/harness/lint-warn-baseline.json` at `5813670`. `after` =
regenerated with `bun run harness:snapshot` (never hand-edited).

| Rule | before | after | note |
|---|---:|---:|---|
| `effect/anyUnknownInErrorContext` | 1 | — | **0 — promoted** (§2) |
| `effect/globalConsole` | 1 | — | **0 — promoted** (§3) |
| `eslint/max-lines` | 2 | 2 | `@kb/ui` |
| `eslint/max-lines-per-function` | 40 | 40 | 37 `@kb/ui`, 3 backend (`b6` §7) |
| `typescript/no-unnecessary-condition` | 1 | 1 | `harness/tests/boundaries-oxlint.test.ts` — `f1`'s file |
| `typescript/no-unsafe-type-assertion` | 8 | 5 | backend **4 → 1**; 4 `@kb/ui` |
| _advisory_ `typescript/no-deprecated` | 7 | 4 | 3 closed in §4; 2 mcp, 2 ui remain |

The ledger's blocking lane is now four rules, and none of them is an
`effect/*`.

Remaining `typescript/no-unsafe-type-assertion` (5): `runtime/src/registry.ts`
(1, §2's documented seam), `ui/src/api/action.ts`,
`ui/src/components/outline/caret.ts`, `ui/src/components/graph/force3d-instance.ts`,
`ui/src/components/graph/force3d-graph.tsx` — the four ui ones are `f1`'s files.

## 7. Needs owner

| Item | Why this wave did not close it |
|---|---|
| `typescript/no-unsafe-type-assertion` — `runtime/src/registry.ts:304` (`asDeclaredInput`) | The last cast at this seam. Closing it means making `parseActionInput` generic in its schema's output type (`ActionSchemaOutput<S>` conditional over `StandardSchemaV1Like` then `{parse}`), typing `ActionDefinition.effect` as `(input: ActionSchemaOutput<TIn>) => …`, and pairing def and handler generically at each definition site so the parse result and the handler's declared input are the same type. That moves the one unavoidable cast inside `parseActionInput`, which is where "parse at the boundaries" says it belongs — but it ripples through `@kb/model`, `@kb/contracts`, 12 core action defs in `@kb/operations`, `@kb/runtime`, and depends on `Effect.fn` propagating a generic through its wrapper, which is unverified. A wave, not a patch. |
| 23 ui test files hand-copy the outline store reset | Gap 01M1P63E3Y5KVHV3XMM6TBV2BM, filed this wave. `packages/ui`-wide. |
| `effect/globalConsole` in `@kb/harness`'s `src/` (2) | Covered by the `scope:tooling` exclude, which is the honest statement: the harness is a script that prints. Not a deferral. |
| `typescript/no-deprecated` (2) — `mcp/src/mcp.ts:209,281` | Unchanged from `b6` §7; `@kb/mcp` is `f1`'s package this wave. |
| `typescript/no-deprecated` (2) — `ui/src/lib/graph-view.ts:231,232` | `LEGACY_*_STORAGE_KEY` migration reads; `graph-view` is `f1`'s file set. |
| `eslint/max-lines-per-function` (3 backend) | Unchanged from `b6` §7: flat literal tables and the CLI command table. |
| `typescript/no-unnecessary-condition` (1) | `harness/tests/boundaries-oxlint.test.ts` — reserved for `f1`. |
| `exactOptionalPropertyTypes` (~17 backend) | Carried from `d1` §6. |

## 8. Shared-file touches

| File | Change | Why |
|---|---|---|
| `tools/kb/tsconfig.bun.json` | plugin `overrides` entry; 15 severity flips | §1, §2 |
| `tools/kb/packages/ui/tsconfig.json` | `include` gains `.storybook` | §1 (`typecheck-scope` found it) |
| `tools/kb/packages/ext-sdk/tsconfig.json` | `include` gains `scripts`, `tests` | §3 |
| `tools/kb/.oxlintrc.json` | one path: `no-console` follows `generate.ts` | §3 — the sanctioned edit |
| `tools/kb/DESIGN.md` | "Effect diagnostic severities and their file scope"; `typecheck-scope`; "Ratchet scope" consequence rewritten | §1 |
| `tools/kb/packages/harness/src/scopes.ts` | new: one reader for path-scope coverage | §1 |
| `tools/kb/packages/harness/src/workspace.ts` | `effectPluginConfig`, `srcGlobsForScope` | §1 |
| `tools/kb/packages/harness/tests/{tsconfig-contract,typecheck-scope,lint-scope-coverage}.test.ts` | `effect-severity-lanes`; new check; restructured | §1 |
| `tools/kb/packages/harness/lint-warn-baseline.json` | regenerated with `bun run harness:snapshot` (never hand-edited) | §6 |
| `tools/kb/packages/contracts/src/actions.ts` | `ActionHandlerError`; handler channel and doc | §2 — granted by the coordinator |
| `tools/kb/packages/model/src/{failure.ts,index.ts}` | `CodedError` | §2 |
| `tools/kb/{package.json,knip.json}` | `gen:ext-sdk` path; ext-sdk entries | §3 |
| `tools/kb/bun.lock` | ext-sdk → contracts/model, operations → ext-sdk | §2 |
| `.kb/nodes.jsonl` | gap 01M1MGT307N4K243CBPJTXNG5X closed; gap 01M1P63E3Y5KVHV3XMM6TBV2BM added — CLI only, never hand-edited | §4 |
| `docs/kb/rules.md` | regenerated by `docs.materialize` | §4 |
| `tools/kb/packages/harness/tests/boundaries-oxlint.test.ts`, `packages/{contracts/src/protocol.ts,mcp}`, ui caret/graph-view/force3d | **not touched** | `f1` owns them |

Outside the briefed `packages/ui` file set, on the coordinator's explicit
go-ahead: `node-content.tsx` (one dead prop line) and 23 test files (one line
each). Recorded here because the brief pinned that set.

## 9. Suite results

| Gate | Result |
|---|---|
| `intent/gate.sh session claude-code` | exit 0 (`SOFT_MISSING: shellcheck actionlint nvfetcher`) |
| `bun install --frozen-lockfile` | clean at branch point |
| `bun run verify` | **exit 0** — typecheck 17/17, oxlint 0 errors, `vp fmt --check` clean, knip advisory-only, harness **47 pass / 0 fail** |
| `bun test packages` | **378 pass / 0 fail**, 57 files |
| `bun run test:ui` | **630 pass / 0 fail**, 89 files |
| `.githooks/pre-commit` | ran and passed on all eight commits |

The UI suite failed twice mid-wave and both were load artifacts, not
regressions: `palette-index.test.ts`'s perf bar (15ms against a 10ms budget) and
two 5-second `testTimeout`s on tests whose reported wall time was ~628 s — a
sibling worktree was saturating the box. Each passed in isolation and the final
quiet-box run is green. `editor-behavior.test.tsx` §3.3 is the one to watch: it
depends on React committing a mount inside `activateNode`'s 250 ms
`fallBackFromMissingHost` timer, so it fails under heavy load by construction.

## 10. Gaps as node ids

- **Closed:** `01M1MGT307N4K243CBPJTXNG5X` — `cursorPosition` deleted (§4).
- **Added:** `01M1P63E3Y5KVHV3XMM6TBV2BM` — 23 ui test files hand-copy the
  outline store reset literal.

The one deferral in §7 that is a real drift marker (`asDeclaredInput`) carries
its reason inline at the site rather than a node: it is the sanctioned
single-boundary trust the brief asked for, not a workaround.
