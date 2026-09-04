# p1c-query-ir — query IR, two live defects, one `normalizeEdnQuery`

Wave `p1c` of `docs/kb/waves/2026-09-05/plan.md`. Branch `feature/p1c-query-ir`,
three commits on `kb-wave/2026-09-05` (`13302bd`, p1b commit 1).

```
bd14135 refactor(kb-ui): one normalizeEdnQuery
d2f7fe6 feat(kb): query IR with parse and compile
bd83697 fix(kb): normalise rules and stop the child-order cartesian
```

`grep -n "function normalizeEdnQuery" tools/kb/packages` → one definition:
`packages/domain/query/src/ir/compile.ts`. Did not touch `index/**`.

## 1. IR grammar as implemented

JSON-serialisable. `parseEdn(edn)` returns structured IR for the stored
subset, else `{ kind: "raw", edn }` (nothing is lost). `compile(ir)` emits
DataScript EDN and folds `normalizeEdnQuery`. `runIr(exec, ir, ids, ...inputs)`
compiles, runs the executor, and revives **only** `node-ref` find positions.

```
Ir = IrQuery | IrRaw

IrRaw   { kind: "raw", edn }

IrQuery {
  kind: "query"
  find: FindPos[]          // each position typed node-ref | scalar | aggregate
  in?:  string[]           // extra :in slots after $  ("% " and var names)
  where: Clause[]
}

FindPos =
  | { kind: "var"; name; type: "node-ref" | "scalar" }
  | { kind: "aggregate"; op: "count" | "collect"; of; type: "aggregate" }
  | { kind: "pull"; of; pattern: PullSpec; type: "node-ref" }

Clause =
  | { kind: "pattern"; entity; attr; value: Term }   // :node/* and :f/*
  | { kind: "children"; parent; child }              // :node/children projection
  | { kind: "reach"; from; to; edge; minHops?; maxHops?; returnPath? }
  | { kind: "rule"; name; args: Term[] }

Term = { t: "var", name } | { t: "str", value } | { t: "num", value } | { t: "bool", value }
```

Find-type inference: entity positions, `:node/id`, `:node/child`,
`:node/mentions`, `:node/children`, `children`, and `reach` vars are
`node-ref`. Aggregates stay `aggregate`. Everything else is `scalar`.

`reach` compiles to a recursive `%` rule. `returnPath` is accepted and ignored
by the DataScript compiler (endpoints only — SQLite can honour it). `minHops: 0`
adds an identity base; `maxHops` compiles a hop-counter rule.

Cartesian `[?p :node/child ?c] [?p :node/child-order ?ord]` collapses at parse
to `{ kind: "children" }` and compiles to
`[?p :node/children ?cs] [(identity ?cs) [?c ...]]`.

## 2. Stored-query shapes (enumerate once)

| Home | Shape today | parseEdn |
|---|---|---|
| `sys.f.query` on `#query` nodes (one live: "All todos live") | `[:find ?id ?text :where [?n :f/sys.f.type ?t] [?t :node/text "todo"] [?n :node/id ?id] [?n :node/text ?text]]` | `query` |
| `.kb/queries/todos.edn` | same plus tag-type join (`?tagType :node/id "sys.tag"`) | `query` |
| `.kb/views/todos.json` / `rules.json` `query` | `[:find ?id :where … type-join … [?n :node/id ?id]]` | `query` |
| `sys.f.targetQuery` on `sys.f.onto.extends` | `[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/id "sys.tag.ontology"] [?n :node/id ?id]]` | `query` |
| `sys.f.onto.query` | field exists; **no stored values** in `.kb/nodes.jsonl` | — |
| `sys.f.lens.query` | field exists; **no stored values** | — |
| `sys.f.view.filter` | **not datalog** — `{:field <id> :eq <value>}` or `{:text "…"}` | `raw` |
| `LIST_*` / `backlinksQuery` / `ONTOLOGY_TARGET_QUERY` | pattern clauses over `:node/*` and `:f/*`, optional literal id | `query` |

No stored query uses `:in`, `%` rules, `pull`, `count`/`collect`, or `reach`.
Those exist on the IR so the MCP/CLI raw surface and the next engine can.

## 3. Three red cases

### Recursive rules (was throw, now rows)

Exact MCP `graph.query` shape from r4 Q4: query
`[:find ?id :in $ % ?tagId :where [?tag :node/id ?tagId] (has-tag ?n ?tag) [?n :node/id ?id]]`
with un-normalised `RULES_SUBTAG` containing `:f/sys.f.onto.extends`.

Before: `DatalogError: Cannot compare :node/id to :f/sys.f.type` (mid-fixpoint).

After (`queryRows` / `runDatalog`): `[["n-direct"], ["n-tagged"]]` for a
root tag with one direct instance and one instance of a child tag.

### Child-order cartesian

Parent `p` with children `[c1, c2, c3]`. Query
`[:find ?cId ?ord :where [?p :node/id "p"] [?p :node/child ?c] [?p :node/child-order ?ord] [?c :node/id ?cId]]`.

Before: 9 rows (3 × 3). After: 3 rows, ids `{c1, c2, c3}`. The unused `?ord`
is dropped from `:find`. Order remains the `:node/children` vector (IR
`children` clause), not an EAV join.

### Count-revival

`[:find ?v (count ?n) :where [?n :f/fld.status ?v]]` on three nodes all
`"doing"` (eids 1..3, count = 3 = eid of `"c"`).

| Surface | Rows |
|---|---|
| `query()` (raw, revive-everything) | `[["doing", "c"]]` |
| `runIr()` (typed: scalar + aggregate) | `[["doing", 3]]` |

## 4. What the migration wave must know

- **Do not migrate `sys.f.view.filter` as datalog.** It is a tiny map EDN
  parsed by `ui/src/lib/view-config.ts`. `parseEdn` already returns `{ kind:
  "raw" }`. Either keep it raw or give it its own IR node (`eq` / `text`); do
  not force it through `IrQuery`.
- **`sys.f.query`, `sys.f.targetQuery`, `.kb/queries/*.edn`, `.kb/views/*.json`
  `query`** are all the same shape: `:find` of `?id` (and sometimes `?text`)
  over `:f/sys.f.type` joins. They parse today. Migration is
  `str` EDN → IR JSON on those props / files, plus `openKbEffect` reading
  both (the third additive migration).
- **`sys.f.onto.query` and `sys.f.lens.query`** have no live values. Seed the
  IR form when first written; no data to convert.
- **`query(edn)` stays the MCP/CLI/WS raw surface** and still revives every
  integer that matches an eid. Operations / render / ontology / hub should
  switch to `runIr` (or `KbIndex.run(ir)` once p1b lands). Mixing them
  reintroduces the count bug.
- **`KbIndex.run(ir)` is not this wave.** `runIr` is the composition the port
  will call. Do not add `run` to the port until p1b is on `main`.
- **`returnPath` on `reach`:** DataScript adapter returns endpoints. The
  SQLite compiler is where path-as-value pays rent.
- **`:node/child-order` datoms** are still emitted (`index/datoms.ts`, p1b).
  Execution no longer joins them. Stopping the emit is p1b's call, not p1c's.

## 5. Acceptance

- `bun run verify`, `bun test packages`, `bun run test:ui` green at each commit.
- One `normalizeEdnQuery` definition.
- Red cases in §3.
