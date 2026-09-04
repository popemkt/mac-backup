# p1c-query-ir — the kb-owned query representation, and two live defects

Wave `p1c` of `docs/kb/waves/2026-09-05/plan.md` (p1 Phase 2f first half,
plus 2e for `query.ts`). Harness: cursor (grok 4.6 high). **Branch from the
integration branch after p1b's commit 1** (the coordinator tells you the
hash). p1b (claude) owns `packages/domain/query/src/index/**` and every
consumer package; you own `packages/domain/query/src/ir/**`, the execution half
of `packages/domain/query/src/datascript.ts` (`normalizeEdnQuery`, `query`,
`queryRows`, `pull`, `reviveValue`/`revivePull`, rules handling), and
`packages/app/ui/src/ds/query.ts` with its test. Nothing else.

Read first: `docs/kb/waves/2026-09-03/briefs/p1-persistence.md` Phase 2f;
`reports/backend-recon/README.md` §9.3 (the `reach` clause) and its defects
section (search "rules" and "child-order"); `reports/datalog-vs-cypher/README.md`
§8; `packages/domain/query/src/datascript.ts`; the stored queries:
`grep -n '\[:find' .kb/nodes.jsonl` (3 today), `.kb/queries/todos.edn`,
`.kb/views/*.json`, and the `sys.f.query` / `sys.f.onto.query` /
`sys.f.targetQuery` / `sys.f.lens.query` / `sys.f.view.filter` props.
`AGENTS.md` Rule 1. Run `intent/gate.sh session cursor` first.

## 1. Two defects first (commit 1: `fix(kb): normalise rules and stop the child-order cartesian`)

- **Recursive rules never normalised.** `normalizeEdnQuery` handles the query
  vector but not the `rules` input, so a recursive rule sent over MCP throws.
  Normalise rules the same way; add the red case (the exact MCP call from the
  r4 report) as a test.
- **`:node/child-order` join cartesian.** The join as written multiplies rows;
  r4 measured it. Fix the query shape and add a test with a node that has
  several children asserting the row count.

## 2. The IR (commit 2: `feat(kb): query IR with parse and compile`)

`packages/domain/query/src/ir/ir.ts`: a small, kb-owned, JSON-serialisable
representation covering **exactly** what stored queries use today — enumerate
them in the report: pattern clauses over `:node/*` and `:f/*`, joins, `:in`
bindings, the recursive closure rule, `pull` patterns, `count`/`collect`.
Plus the one clause r4 asks for: `reach { from, edge, minHops?, maxHops?,
returnPath? }`. Every `:find` position carries a type: `node-ref`, `scalar`,
or `aggregate`.

`ir/parse.ts`: `parseEdn(edn): Ir` for the subset; anything outside it becomes
`{ kind: "raw", edn }` so nothing is lost. `ir/compile.ts`: `compile(ir):
{ query: string; rules?: string }` for DataScript; `normalizeEdnQuery` folds
into the compiler and gets one home. `runIr(edn-executor, ir)` composes them
and revives **only** `node-ref` positions — the `[:find ?v (count ?n)]` bug
from the r4 report is the red case. `query(edn)` keeps today's behaviour for
the raw surface and says so in its docblock.

Round-trip property test: for each stored query and a generated corpus,
`compile(parseEdn(edn))` returns the same rows as `edn` on the fixture graph.

## 3. The browser copy (commit 3: `refactor(kb-ui): one normalizeEdnQuery`)

`packages/app/ui/src/ds/query.ts` holds a verbatim copy of
`normalizeEdnQuery`. Delete it; import from `@kb/query` (`scope:shared`, the
boundary allows it). Do not touch `ds/datoms.ts` or `ds/db.ts` — their builder
mirror is a later wave, after p1b.

## Do not

- Migrate stored props or `.kb/queries/*.edn` to IR, or add `run(ir)` to the
  port — next wave, once p1b is on `main`.
- Touch `index/**`, `operations`, `runtime`, `server`, `cli`, `mcp`,
  `store-jsonl`, `model`, `ds/datoms.ts`, `ds/db.ts`.

## Acceptance

`bun run verify`, `bun test packages`, `bun run test:ui` green.
`grep -rn normalizeEdnQuery tools/kb/packages` → one definition. Red cases
in the report: recursive rule via `runDatalog` (was throw, now rows); the
count-revival case; the child-order row count.

## Report

`docs/kb/waves/2026-09-05/reports/p1c-query-ir.md`: the IR grammar as
implemented, the enumerated stored-query shapes, the three red-case outputs,
what the migration wave must know (which props hold which shapes).
