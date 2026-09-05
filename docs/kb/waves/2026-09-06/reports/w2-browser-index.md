# w2-browser-index — the browser's graph is a DatascriptIndex replica

Wave `w2` of `docs/kb/waves/2026-09-06/plan.md`. Brief
`briefs/w2-browser-index.md`. Harness: cursor. Branch
`feature/w2-browser-index` from `main` @ `5e1c0ed` (plan base `b811a9f`).
Owned `tools/kb/packages/app/ui/**` plus this report. Did not touch
`packages/domain/query/**`, the write path, or WS rev/gap handling.

## Commits

| # | hash | what |
|---|---|---|
| 1 | `fce17b9` | `test(kb-ui): every UI datalog string under both schemas` |
| 2 | `f8fc6d4` | `refactor(kb-ui): DatascriptIndex replaces src/ds` |
| 3 | `899318f` | `perf(kb-ui): measure` |
| — | merge of `1e48855` | w1 `KbIndex.run(ir)` (extractMentions barrel) |
| 4 | this commit | `extractMentions` re-exported from `@kb/query` |

`bun run verify`, `bun test packages` (362) and `bun run test:ui` (628) green
at commit 2. `grep -rn "buildQueryDb\|init_db" tools/kb/packages/app/ui` empty.

## `:f/*` audit (commit 1)

Every production EDN string the UI runs, on the fixture graph (52 nodes),
against both the forked builder (ref-typed `:f/*`) and `DatascriptIndex`.
**Zero unexplained row-count diffs.** No production query needed a join rewrite.

| id | fork | index | same |
|---|---|---|---|
| queries.list-all | 52 | 52 | true |
| queries.list-fields | 26 | 26 | true |
| queries.list-tags | 3 | 3 | true |
| queries.backlinks-n.root-a | 0 | 0 | true |
| query-node.default | 52 | 52 | true |
| schema-zoom.tagged-todo | 2 | 2 | true |
| schema-zoom.field-status | 2 | 2 | true |
| graph-lens.todo-via-id | 2 | 2 | true |
| field-type.target-query-text | 1 | 1 | true |
| ontology-scope.outsider | 0 | 0 | true |
| diagnostic.join-via-text `[?n :f/x ?t] [?t :node/text …]` | 2 | 2 | true |
| diagnostic.join-via-node-id-value `[?n :f/x ?ref] [?t :node/id ?ref]` | 0 | 0 | true |

The brief predicted `[?n :f/x ?t] [?t :node/text]` would diverge because the
index does not declare `:f/*` as `:db.type/ref`. On this fixture it does not:
resolved prop refs are stored as eids (numbers) in both builders, so an entity
join through `[?t :node/text]` / `[?t :node/id "literal"]` works without the
schema flag. The brief's value-join `[?t :node/id ?ref]` is empty on **both**
because `:node/id` is a string, not an eid. Production schema-zoom already
joins `[?t :node/id "${tagId}"]` (entity, then read id) — same shape as
`LIST_FIELDS_QUERY`.

Fixture backlinks for `n.root-a` are empty (no mentions in seed text). An extra
case that puts `[[n.root-a]]` on `n.root-b` matches on both schemas. After
commit 2 the dual-schema runner is gone; `schema-compat.test.ts` pins the
index-only counts above as a regression suite.

## The replica (commit 2)

`src/ds/{datoms,db,query}.ts` and `datoms.test.ts` deleted (sorted eids and
ref-typed `:f/*` were contracts of the fork). `src/ds/index.ts` is the one
seam: re-exports `KbIndex` / `DatascriptIndex`, `runQuery = (ix, edn) =>
ix.runDatalog(edn)`, `queryBacklinks` over `backlinksQuery`.

`outline.store.ts`: `queryDb` → `index: KbIndex`. `hydrateFromWire` constructs
once (`new DatascriptIndex(wireNodes)`). `applyTx` calls `index.applyTx`.
`restoreSnapshot` / `refreshFromWire` call `index.rebuild` on the existing
instance (virtual nodes survive `rebuild`, not construction). `projectWire`
no longer builds a db. Ontology scope is a projection: the index stays
global, only `nodes` is scoped.

Graph-content memos subscribe to `index.generation`, not server `rev`. `rev`
still paints the header. `store.search` routes through `index.search` then
filters to the scoped `nodes` map. `searchNodes` (text *or* id-substring) is
deleted — `KbIndex.search` is text-only.

`datascript` dropped from `@kb/ui`'s dependencies; `@kb/query` still owns it.
Knip identities for the deleted `Datom` / `PropValue` types were frozen out
via `bun run harness:snapshot` (not a hand-edit).

### `wireNodes` vs `index.storedNodes()`

**`wireNodes` stays this wave.** Planners (`actions/plan.ts`) already read it;
w5 owns the write path. Deriving a second snapshot from `index.storedNodes()`
and keeping it in sync with `wireNodes` by hand would be a mirror. One
snapshot, one owner, until w5 moves the write path onto the replica.

### `extractMentions`

w1 `1e48855` exported it from `@kb/query`. Merged that commit; the seam is
now `export { extractMentions } from "@kb/query"`. No second implementation.

## Perf (commit 3)

One-off, not a gate. 50 successive text edits of `n.root-a` on the fixture
graph (52 nodes). Old path: full `init_db` per edit (`buildQueryDb` as every
`applyTx` used to). New path: one `DatascriptIndex` then `applyTx` per edit.
Measured immediately before deleting the fork, same process, one warmup each.

| path | n | total ms | mean | p50 | p95 | `index.rebuilds` |
|---|---|---|---|---|---|---|
| old: `init_db` every edit | 50 | 60.926 | 1.219 | 0.903 | 3.911 | 50 (every call) |
| new: `applyTx` | 50 | 11.544 | 0.231 | 0.117 | 0.559 | 1 (constructor only) |

New path is ~5× faster on this graph; generation is 51 (1 rebuild + 50
incremental txs). A first-seen field attr still falls back to `rebuild`
inside `DatascriptIndex` — this script only edits existing text, so it stays
on the incremental path.

## Left

- w5: `wireNodes` can become `index.storedNodes()` when planners stop owning
  a parallel snapshot.
- w4: WS ingest stays as it is (`rev` / gap); the replica is fed by the
  existing `applyTx` / snapshot frames.
- Search no longer matches node ids as substrings (only text). Palette /
  jump-by-id still have their own indexes.
