# w1-run-ir-one-store — `run(ir)` on the port, one store interface

Wave `w1` of `docs/kb/waves/2026-09-06/plan.md`. Harness: codex. Branch from
`main`. Runs beside `w2` (cursor, UI only). You own:
`tools/kb/packages/domain/query/**`, `tools/kb/packages/contract/contracts/src/{store,session}.ts`,
`tools/kb/packages/infrastructure/store-jsonl/src/jsonl-store.ts` (the
`Store` half and `asPromiseStore` only), `tools/kb/packages/app/runtime/**`,
`tools/kb/packages/app/server/tests/field-target.test.ts`,
`tools/kb/packages/infrastructure/store-jsonl/tests/benchmark.test.ts`, every
test that constructs a `Store`/`asPromiseStore`, `packages/extension/ext-canvas/**`
only where it reads `ctx.store`, and your report. Not `packages/app/ui/**`.

Read first: `docs/kb/waves/2026-09-05/reports/p1b-kbindex-port.md` §"What the
next wave needs to wire `run(ir)`", `reports/p1c-query-ir.md` §4,
`reports/p1c-fix-one-collapse.md` §4; `packages/domain/query/src/index/{index,datascript-index}.ts`,
`src/datascript.ts` (`runIr`, `datascriptExecutor`), `src/ir/*.ts`,
`src/queries.ts`; `packages/contract/contracts/src/store.ts` (both interfaces),
`contracts/src/session.ts` (`KbContext.store` and `effectStore`);
`AGENTS.md` Rule 1; `tools/kb/AGENTS.md` incl. Effect. Run
`intent/gate.sh session codex` first.

## Commit 1 — `feat(kb): KbIndex.run(ir)`

- `KbIndex` gains `run(ir: Ir, ...inputs): Array<Array<unknown>>`. In
  `DatascriptIndex` it is one line: `runIr(datascriptExecutor(db), ir, ids, ...inputs)`.
  `runDatalog(edn)` stays, documented as the raw surface (it revives every eid;
  `run` revives only `node-ref` positions).
- Delete `DatascriptIndex.handle` (its docblock says it closes when `run(ir)`
  lands). `runDatalog`/`pull` stop delegating through it. `grep -n "\.handle"`
  over `packages` must be empty; migrate `field-target.test.ts:45` and
  `benchmark.test.ts:71`.
- `queries.ts`: `backlinksQuery(id)` interpolates the id into EDN with no
  escaping. Express the four `LIST_*`/backlinks constants as `Ir` values with
  the id as a bound `:in` term; keep EDN-string exports only where a consumer
  needs EDN (the UI does, until w2 lands — check `packages/app/ui/src/ds/db.ts`
  and `operations/src/map.ts`; both may keep the string form this wave).
- Export `extractMentions` from `@kb/query`'s barrel (w2 needs it).
- Red cases: `run` on a `[:find ?v (count ?n)]` query returns the count as a
  number where `runDatalog` returns a revived id; `backlinks` via `run` with an
  id containing `"` works.

## Commit 2 — `refactor(kb): one store interface`

The Promise `Store` in `contracts/src/store.ts` and `EffectStore` are two
interfaces for one concept (review finding; gap already filed — find it with
`kb search "two persistence interfaces"` and close it in the report).

- Delete `Store`; rename `EffectStore` → `KbStoreApi`? **No** — keep the name
  `EffectStore` only if renaming touches nothing you do not own; otherwise
  rename is a follow-up. The interface is `{ path, loadEffect, commitEffect }`.
- `KbContext` loses `store`; `effectStore` is the one field (rename to `store`
  if every reader is in your ownership — `grep -rn "ctx.store\|\.effectStore"`
  decides). `JsonlStore` implements the one interface; delete `asPromiseStore`.
- Legacy Promise handlers (`handler(ctx, input)` in extensions) that read
  `ctx.store.commit(...)` switch to `Effect.runPromise(ctx.effectStore.commitEffect(...))`
  at the call site, or better, become `effect:` handlers if the change is
  mechanical. List each in the report.
- Tests that built a Promise store build the Effect one.

## Acceptance

`bun run verify`, `bun test packages`, `bun run test:ui` green.
`grep -rn "asPromiseStore\|interface Store\b\|\.handle\b" tools/kb/packages` empty
(UI excluded for `.handle` only if w2 has not merged). Gap for the dual
interface closed (`status=done` via the CLI, and say so). Report:
`docs/kb/waves/2026-09-06/reports/w1-run-ir-one-store.md` — the `run`
signature, deleted symbols, the handlers you converted, and what `run(ir)`
still cannot express (if anything) that a consumer asked for.
