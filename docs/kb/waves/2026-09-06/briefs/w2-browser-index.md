# w2-browser-index — the browser's graph is a `DatascriptIndex` replica

Wave `w2` of `docs/kb/waves/2026-09-06/plan.md`. Harness: cursor. Branch from
`main`. Runs beside `w1` (codex; backend). You own
`tools/kb/packages/app/ui/**` only, and your report. Do not touch
`packages/domain/query/**` — if you need an export from `@kb/query` that is
missing (`extractMentions` is being added by w1), stop and say so in your first
heartbeat; the coordinator will merge w1's commit 1 to you.

Read first: `tools/kb/packages/app/ui/ARCHITECTURE.md`; `src/ds/{datoms,db,query}.ts`
and their tests; `src/stores/outline.store.ts` (`projectWire` :190-212, the
seven `set({wireNodes, nodes, queryDb, …})` blocks); `src/api/{live,ws,graph}.ts`;
`packages/domain/query/src/index/{index,datascript-index,datoms}.ts` (read
only) — especially `datoms.ts:140-173` on why `:f/*` attrs are **not**
ref-typed in the index while `src/ds/datoms.ts:133-151` makes them ref-typed;
`AGENTS.md` Rule 1. Run `intent/gate.sh session cursor` first.

## Why

`src/ds/**` is a hand-forked copy of `@kb/query`'s datom builder (its own
header says so) with divergent eid allocation (sorted per build vs monotonic),
divergent schema, a slightly wrong mention regex, and revive-every-eid
semantics (the count bug the server fixed). Every `applyTx` rebuilds the whole
DataScript db with `init_db`. One index type, two instances, one replica.

## Commit 1 — `test(kb-ui): every UI datalog string under both schemas`

Before touching production code, enumerate every EDN string the UI runs
(`graph-lens.ts`, `ontology-scope.ts`, `schema-zoom.ts`, `field-type.ts`,
`query-node.ts`, `visible-instances.ts`, `references-section.tsx`,
`query-results.tsx`, and `queries.ts` constants) and run each against the
fixture graph on both `buildQueryDb` (old) and `new DatascriptIndex(nodes)`
(new). Any query that joins through a `:f/*` prop as a ref (`[?n :f/x ?t] [?t
:node/text ?s]`) returns different rows under the index, because the index
stores prop refs as string sentinels and joins go through `:node/id`. Fix each
such query to join via `[?t :node/id ?ref]` and commit the table of
before/after row counts in the report. This commit is the safety net for the
rest.

## Commit 2 — `refactor(kb-ui): DatascriptIndex replaces src/ds`

- Delete `src/ds/datoms.ts`, `src/ds/db.ts`, `src/ds/query.ts` and their
  tests (`datoms.test.ts` asserts sorted eids and ref-typed `:f/*` — contracts
  that are gone; delete, do not port).
- Add `src/ds/index.ts` (~40 lines, the one seam): re-export `KbIndex`,
  `runQuery = (ix, edn) => ix.runDatalog(edn)`, `queryBacklinks` over
  `backlinksQuery`, `extractMentions` re-exported from `@kb/query`.
- `outline.store.ts`: `queryDb` → `index: KbIndex` built once in
  `hydrateFromWire` (`new DatascriptIndex(nodes)`); `applyTx` calls
  `index.applyTx({upserts, deletes})`; `refreshFromWire`/`restoreSnapshot`
  call `index.rebuild(nodes)` (never construct a new index — virtual nodes
  survive `rebuild`, not construction). `projectWire` stops building a db.
  `wireNodes` may stay this wave (planners read it), or become
  `index.storedNodes()`; say which and why.
- Memo keys: `rev` is the server counter and does not move on local
  optimistic applies; `index.generation` does. Replace `rev`-keyed memos with
  `generation` where the memo is over graph content.
- `store.search` duplicates `KbIndex.search`; route it through the index.
- Swap `QueryDb` → `KbIndex` in the seven consumer modules; migrate the eleven
  tests that import `@/ds/*` (most are one-line substitutions);
  `outline.store.test.ts:198-213` reads `qdb.ids.toEid`/`qdb.rev` — rewrite
  against `generation`.
- Ontology scope is a projection over a global db (`outline.store.ts:185-189`):
  the index stays global; only `nodes` is scoped.

## Commit 3 — `perf(kb-ui): measure`

`bun run test:ui` green; then a one-off measurement in the report: keystroke
→ applyTx time and `index.rebuilds` count over a 50-edit script on the
fixture graph, old vs new. No gate, a table.

## Do not

- Touch the write path (`actions/plan.ts`, `mutations.ts`, `optimistic.ts`)
  beyond type renames. w5 owns it.
- Touch `api/ws.ts`/`api/live.ts` semantics (rev/gap handling). w4 owns it.
  Type-only edits are fine.

## Acceptance

`bun run verify`, `bun run test:ui` green; `grep -rn "buildQueryDb\|init_db"
tools/kb/packages/app/ui` empty; the `:f/*` audit table in the report with
zero unexplained row-count differences. Report:
`docs/kb/waves/2026-09-06/reports/w2-browser-index.md`.
