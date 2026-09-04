# f2-effect-promotion — make the Effect lane promotable, narrow the extension contract

Follow-up wave after `b6`. Harness: claude. Branch from the current head of
`kb-wave/2026-09-03`. Runs in parallel with `f1` (cursor), which owns
`packages/contracts`, `packages/ui` (caret, graph-view, force3d), `packages/mcp`
and `packages/harness/tests/boundaries-oxlint.test.ts`; **do not touch those**.

Read first: `CLAUDE.md` (Rule 1, Effect subsection), `tools/kb/DESIGN.md`
("Compiler strictness contract", "Ratchet scope", "Size is a signal"),
`reports/b6-tighten-backend.md` §6–§7, `reports/g2-strict-stack.md` (tsconfig
layering and `SANCTIONED_TSCONFIG_DELTAS`), `packages/harness/src/*`. Run
`intent/gate.sh session claude-code` first.

## 1. The problem to solve

Nine `effect/*` diagnostics are at 0 in every package's `src/`
(`asyncFunction`, `globalDate`, `globalErrorInEffectCatch`,
`globalErrorInEffectFailure`, `globalTimers`, `lazyEffect`,
`leakingRequirements`, `schemaNumber`, plus `processEnv`). Doctrine says a
rule at 0 is promoted. Promotion for these means `diagnosticSeverity: "error"`
in the `@effect/language-service` plugin config — and that config lives in
`tsconfig.bun.json`, which every backend package's `tsconfig.json` (src **and**
tests) extends. `test("…", async () => …)` would then fail typecheck. The
ratchet's `src/`-only scope papered over this; the compiler contract must say
it instead.

**Design the layer, do not special-case.** Options to evaluate, pick one,
record it in DESIGN.md "Compiler strictness contract":

- (a) a `tsconfig.bun.test.json` preset that extends `tsconfig.bun.json` and
  relaxes only the Effect-preference diagnostics to `suggestion`; each
  backend package gets `tsconfig.json` (src) + `tsconfig.test.json` (tests);
  `nx typecheck` runs both; harness `workspace-shape` / `tsconfig-contract`
  checks learn the pair as the *one* sanctioned shape (no per-package
  deltas); `ratchet` collector then counts the whole project (drop the
  `src/`-only rule if the test preset makes it redundant — one mechanism).
- (b) keep one tsconfig per package and move the Effect-preference group to
  `error` only where the plugin supports per-path severity (check the
  language-service docs; if it cannot, say so and pick (a)).

Whichever you choose: `bun run verify` stays one command, `nx` project
graph still finds every project, the harness has a red test for a package
missing its test tsconfig, and `DESIGN.md` states the rule once.

Then promote: the nine (and `processEnv`) to `"error"` in the src preset.
`bun run typecheck` must be green.

## 2. The extension handler contract (b6 §7)

`operations/src/extension-loader.ts:138,146` and `runtime/src/registry.ts:307,316`
assert `effect`/`handler`/`template` from `unknown`, and
`effect/anyUnknownInErrorContext` at `registry.ts:307` is the `unknown` error
channel at the same seam. Both are one fact: the extension SDK's exported
handler type is looser than what the registry accepts. Extensions are kb's
own (`ext-canvas`, `ext-docs`). Narrow the contract in `packages/ext-sdk`
(`Schema` for the declarative part, a typed function shape for the handler
with a typed error channel), make the loader decode it once, and delete the
four assertions and the `unknown` error. If a runtime check cannot verify a
function's signature, the SDK type carries it and the loader trusts the
module boundary *once*, with a comment saying so — not four times.

## 3. `ext-sdk/src/generate.ts` console (b6 §7)

A generator script inside a `scope:backend` package's `src/`. Move it out of
`src/` (`packages/ext-sdk/scripts/generate.ts`), update the `package.json`
script and the `.oxlintrc.json` `no-console` override path for it (this is
the one `.oxlintrc.json` edit you may make), so the suggestion lane's
`src/`-scope rule — or the test preset from §1 — covers it without a second
exception list.

## 4. `cursorPosition` → `CaretIntent` (b4 §5b, gap `01M1MGT307N4K243CBPJTXNG5X`)

Three `no-deprecated` sites (`canvas-card.tsx:40,137`, `outline.store.ts:352`).
Read the gap node; if the migration it names is a bounded change to the
canvas card's caret channel (the outline already uses `CaretIntent`), do it
and close the gap via the kb CLI. If it is not bounded, write the reason in
the report and leave it. This is the only `packages/ui` file set you may
touch (`canvas-card.tsx`, `outline.store.ts`, their tests).

## Rules

- No hand edits to `lint-warn-baseline.json`; `bun run harness:snapshot`
  after changes. `.oxlintrc.json`: only the §3 path edit. `tsconfig*`: §1.
- Behaviour changes: none expected beyond §4. List any.
- `bun run verify` green per commit; `bun test packages` and
  `bun run test:ui` green. Commit style `refactor(kb): …` / `chore(kb): …`.
  No push.

## Report

`docs/kb/waves/2026-09-03/reports/f2-effect-promotion.md` on the branch:
the tsconfig layer chosen and why, the promoted list, the new contract type,
before/after ledger, anything left.
