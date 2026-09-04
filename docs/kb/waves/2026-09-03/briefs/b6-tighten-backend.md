# b6-tighten-backend — backend ledger and Effect lane to zero

Wave `b6` of `docs/kb/waves/2026-09-03/plan.md`. Harness: claude. Branch
from `kb-wave/2026-09-03` (head includes `c1`). Scope: every package under
`tools/kb/packages/` **except `ui`** (`b4`/`b5` own ui, in parallel).

Read first: `CLAUDE.md` (Rule 1, Effect subsection —
`tools/kb/node_modules/effect/AGENTS.md` completely), `tools/kb/DESIGN.md`
("Ratchet scope", "Domain typing"), `reports/b1-burndown-backend.md` §7,
`reports/b2-burndown-backend-tests.md`. Run `intent/gate.sh session
claude-code` first.

## 0. Owner decisions this wave carries

- **Backend is Effect-native.** An `async function` in a package `src/` is
  modelled as an Effect (`Effect.gen` inline, `Effect.fn("name")`,
  `Effect.tryPromise` for foreign promises). A framework callback that must
  be a promise (Bun `fetch` handler, MCP SDK handler, CLI entry) is a thin
  edge: one `runPromise`/`runFork` against `kbRuntimeLayer`, body is Effect.
  If a package already has such an edge, use it; never add a second runtime.
- **Clock and timers are services.** `Date.now()`/`new Date()` →
  `Clock`/`DateTime` from `effect`; `setTimeout` → `Effect.sleep`/`Schedule`.
  Tests that need a fixed time use `TestClock`. (`ext-canvas` wall-clock
  `updatedAt` was an owner item — same fix.)
- **Errors are tagged.** `new Error(...)` inside `Effect.fail`/`catch` →
  the package's `Schema.TaggedError`; fold with `ensureDomainError` where a
  domain boundary already does.
- **One narrowing helper: `present` from `@kb/model`.** Retire
  `expectDefined`: replace its uses in backend tests with
  `present(value, "<what the test needs>")`, delete
  `packages/test-kit/src/expect-defined.ts` and its export, fix the comment
  in `present.ts` and the harness constraint comment that names it, and
  update the `#rule`/DESIGN mention if any (`grep -rn expectDefined`).
- **Type assertions become parses.** At an I/O boundary (`JSON.parse`,
  process args, MCP payloads, JSONL lines) decode with the `Schema` that
  already exists for the shape; inside domain code a `as` means the type is
  wrong — fix the type. `canvas` (10) and `operations` (9) are the two
  clusters; look for the one shape behind each before editing sites.
- **Tooling output.** `packages/harness` prints with `console` because it is
  a script, not kb. If `globalConsole` there is honest noise, the fix is the
  collector's scope (`snapshot.ts` counts `scope:tooling` out — one rule from
  the tag it already carries), not `process.stdout.write`. `ext-sdk
  generate.ts` already has a `no-console` override; treat it the same way.

## 1. Targets (counts at `c1`)

Effect lane (`effect-tsgo`, `src/` only): `asyncFunction` 62 (cli 28,
server 17, mcp 7, operations 4, ext-sdk 3, test-kit 2, model 1),
`globalErrorInEffectFailure` 4 + `globalErrorInEffectCatch` 1 (cli),
`globalDate` 5 (store-jsonl 3, model 2), `globalConsole` 3 (harness 2,
ext-sdk 1), `globalTimers` 1 (server), `lazyEffect` 2,
`leakingRequirements` 1, `anyUnknownInErrorContext` 1, `schemaNumber` 1
(model — `Schema.Number` → `Schema.Finite`/`Schema.Int` as the field means).
Expected end state: **0**.

oxlint (`bun run lint`): `typescript/no-unsafe-type-assertion` 49 (cli 11,
canvas 10, operations 9, store-jsonl 4, runtime 4, model 3, test-kit 3,
mcp 2, query 2, ext-sdk 1) → 0; `eslint/no-await-in-loop` 3 (server 2,
operations 1) → restructure (`Effect.forEach` with concurrency 1 when order
matters) else pinpoint disable with reason; `unicorn/consistent-function-scoping`
7 (runtime tests 4, model 2, render-tests 1) → 0; `eslint/max-nested-callbacks`
(cap 4) `cli.ts` ~706 → 0; `typescript/no-deprecated` mcp 2 → 0;
`eslint/max-lines-per-function` model 2 / cli 1 → only if a step falls out
on its own.

Measure with `bun run lint` and
`node_modules/.bin/effect-tsgo diagnostics --project packages/<p>/tsconfig.json --format json`;
regenerate the ledger with `bun run harness:snapshot` — never hand-edit it.
Do not change rule severities or `.oxlintrc.json`; the coordinator promotes
at integration.

## 2. Rules of the wave

- Rule 1: one edge per package, one clock, one error type per failure kind.
  If converting a cli command to Effect reveals the command table itself is
  the abstraction to fix, fix the table once rather than 28 handlers
  individually — and say so in the report.
- Behaviour-neutral except §0. Every §0 change listed in the report.
- `bun run verify` green per commit; `bun test packages` green. Commit in
  rule- or package-scoped commits (`refactor(kb): …`). No push.

## 3. Report

`docs/kb/waves/2026-09-03/reports/b6-tighten-backend.md` committed on the
branch: before/after per rule and per package; the edges/services introduced;
`expectDefined` retirement diff summary; behaviour changes; anything left
with why.
