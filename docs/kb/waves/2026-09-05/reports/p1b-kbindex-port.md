# p1b — the KbIndex port and its DataScript implementation

Wave `2026-09-05`, brief `briefs/p1b-kbindex-port.md` (p1 Phases 2a–2d).
Harness: claude (opus, high). Branch `feature/p1b-kbindex-port`, based on
`91d5db3`, with `main` merged twice as p1a and p1c landed.

## Commits

| # | hash | what |
|---|---|---|
| 1 | `13302bd` | split `datascript.ts` into builder (`index/datoms.ts`) and execution halves — p1c's start point |
| 2 | `8e2731f` | the `KbIndex` port and `DatascriptIndex` |
| 3 | `3589924` | re-home the owners: the session carries an index, not a `QueryDb` |
| 4 | `6d67c3a` | reload only when the store file changed |
| — | `52d7b2b` | merge p1a (store baseline) |
| — | `3b35bf7` | merge p1c (query IR) |
| 5 | `31d71d0` | persist catches the session up before it commits (p1a's finding) |
| 6 | `e6499e1` | one way to build a datascript db — `buildQueryDb` deleted |

`bun run verify`, `bun test packages` (356) and `bun run test:ui` (631) are
green at the tip. Two pre-existing perf assertions are load-flaky on a busy
machine and pass on a quiet one: `store-jsonl` `benchmark.test.ts` (p1a's, no
longer a gate) and `ui/src/lib/palette-index.test.ts` (`keyMs < 10`, measured
20 ms under a parallel `tsc`). Neither is touched by this wave.

## The port

`packages/domain/query/src/index/index.ts`. `KbIndex` is the brief's interface
with one addition, `storedNodes()`, argued below. `KbIndexService` is the
Effect service; `kbRuntimeLayer` provides it from `ctx.index`.

`DatascriptIndex` (`index/datascript-index.ts`) is the only implementation and
the only code in the workspace that calls `init_db` — once, in `rebuild`.

### Deleted symbols

| symbol | was in | replaced by |
|---|---|---|
| `buildQueryDb` | `query/datascript.ts` → `index/datoms.ts` | `new DatascriptIndex(nodes)` |
| `QueryDb` (the `{db, ids, nodes}` record) | same | `DatascriptDb` (`{db, ids}`); the node map is the index's |
| `buildIdMap` | same | monotonic allocation inside the index |
| `nodesToDatoms` (the whole-graph builder) | same | per-node `nodeToDatoms(node, ids)` + `schemaFor(attrs)` |
| `rebuildQdb` + `isVirtualQueryNode` + the `previousRealIds` argument | `operations/session.ts` | `KbIndex.withVirtual` / `storedNodes` |
| `KbContext.qdb` | `contracts/session.ts` | `KbContext.index` |
| assignment to `KbContext.nodes` (6 sites) | everywhere | `nodes` is a derived read of `index.storedNodes()` |
| `SubscriptionHub.contentHash` + `this.hash` | `server/session.ts` | the diff the hub already computes is the no-op guard |
| `SubscriptionHub.normalizeRows` | same | `KbIndex.runDatalog` returns rows |
| `SubscriptionHub.virtual` + `withVirtual` (private) | same | the index owns the virtual set |

`extractMentions` and `MENTION_RE` moved with the builder into `index/datoms.ts`;
`docs.ts`, `ontology.ts` and `actions.ts` no longer import `query`/`queryRows`/
`pull` at all.

### The eid allocation rule

Eids are **allocated monotonically on a node id's first appearance and never
reused**. `#nextEid` only ever increases, for the life of the process.

- `rebuild(nodes)` keeps every mapping whose id is still present, drops the
  mappings of ids that are gone, and allocates for ids it has not seen. It does
  not renumber — an eid means the same node before and after a rebuild.
- `applyTx` allocates for created ids before deriving any datoms (so refs to
  them resolve in the same transaction) and forgets the mappings of deleted ids
  before deriving them (so refs to them dangle in the same transaction).
- Deleting a node retires its number: the mapping goes, the counter does not
  rewind. A node deleted and re-created with the same id gets a fresh eid, so a
  revived integer never names a node that no longer exists.

The old `buildIdMap` was positional (sort by id, number 1..n), which renumbered
every node whenever any node was added. Nothing outside `reviveValue` /
`revivePull` / `pull` reads an eid, and all three only need eid → NodeId.

### How `applyTx` stays incremental

Per entity, the datoms it *has* (`d.datoms(db, ":eavt", eid)`) are diffed
against the datoms it *should* have (`nodeToDatoms`), and only the difference
is transacted with `d.db_with`. An ordinary text edit moves two datoms.

Three things had to be true for the incremental path to answer exactly what a
rebuild answers, and each is a red case in
`packages/domain/query/tests/datascript-index.test.ts`:

1. **References heal.** A node's datoms depend on whether its targets exist: a
   dangling prop ref degrades to its id string, a dangling child or `[[id]]` is
   dropped. The index keeps the reverse of "what does this node point at", so
   when an id appears or vanishes every referrer is re-derived in the same
   transaction. Without it a dangling ref would stay dangling forever, which a
   rebuild never did.
2. **Cardinality is declared.** `init_db` takes raw datoms and ignores
   cardinality; `db_with` transacts, and a cardinality-one `:db/add` *replaces*
   the previous value. Props are multi-valued and a parent has one
   `:node/child-order` datom per child, so every such attr is now
   `:db.cardinality/many`. One derivation (`schemaFor`) feeds both paths.
3. **Field attrs are not ref-typed.** They never were, in the sense that
   matters: a prop ref is a plain eid and datalog joins read it as an entity
   either way. But a *dangling* prop ref survives as its id **string**
   (`DANGLING_REF_DECISION`), and a string on a ref-typed attr is a **tempid**
   to `db_with` — DataScript rejects the transaction with "Tempids used only as
   value in transaction". Declaring those attrs `:db.type/ref` would make the
   incremental path reject exactly the data the rebuild path keeps, so only
   `:node/child` and `:node/mentions` (which never carry a dangling value) are
   ref-typed. No pull pattern or reverse-ref query in the tree reads a `:f/*`
   attr, so nothing observable changed; the whole suite agrees.

The one thing `db_with` cannot do is grow the schema, so a transaction that
introduces a **first-seen attr** falls back to a full rebuild, counted in
`DatascriptIndex.rebuilds`.

### Benchmark

50 076 nodes (system seed + 50 000, every tenth tagged), Bun 1.3.14, three runs
on this machine, quiet:

| operation | ms | rebuilds |
|---|---|---|
| build the index from 50 076 nodes | 182 / 237 / 284 | 1 (the build itself) |
| one tag-join query (5 000 rows) | 29 / 38 / 47 | — |
| edit one node's text | 2.5 / 3.0 / 4.8 | **0** |
| add a ref prop with a known field | 0.3 / 0.4 / 0.4 | **0** |
| delete one node | 0.8 / 1.0 / 1.1 | **0** |
| add a prop with a **first-seen** field | 178 / 183 / 215 | **1** |
| `search` over 50 076 nodes | 1.6 | — |

The interactive path is asserted, not just measured:
`packages/app/server/tests/index-rebuilds.test.ts` drives a real `POST
/api/action` through `handleHttpRequest` and asserts the rebuild counter does
not move — including the watcher's follow-up reload — and that a write from
another process is picked up for exactly one rebuild. Before this wave the same
edit performed three full builds (reload + persist + `applyNodes`), ~550–850 ms
at this size.

## Reload became a question about the file

`http.ts` reloaded before every action while the `fs.watch` debounce reloaded
after every write — two mechanisms for one concern, and the reason an edit cost
three index builds. The check now lives inside `reloadEffect`: the session
remembers the store file's size and mtime, `persistEffect` refreshes it after
committing, and `openKbEffect` records it (`noteStoreSynced`) because a session
is in sync with the file it just read. Call sites are unchanged — there is
still one way to ask — and a reload that finds nothing new costs a `stat`.

`persistEffect` runs the same check *before* it commits. This is p1a's finding
(`JsonlStore.commitEffect` reloads, merges and replaces the whole file under a
lock, so another process's nodes land in the file this commit produces):
applying only the caller's tx to an index that never saw them would leave the
session behind its own store, with a fresh stamp calling that state current.
Catching up first also means integrity is checked against the graph the commit
merges into. `commitEffect`'s signature was **not** changed.

What size+mtime cannot see is a `#gap` node (`01M1PK5NYA7ZG3XC0H0YRYRVZE`): a
same-tick same-byte-count external write, and the window between the check and
the store's own locked reload. Both need a second process writing the same
store; both close with Phase 3's fingerprint, or with `commitEffect` returning
the merged snapshot.

## Deviations from the brief, and why

- **`storedNodes()` is on the port** (not in the brief's interface). The brief
  asks for `index: KbIndex` and "no separate `nodes` map if the index owns it".
  The index does own it — but `allNodes()` includes the virtual saved-query
  nodes, and persist, transaction integrity and the WS snapshot must operate on
  the stored ones only. Without the projection, `KbContext.nodes` would have had
  to stay a second, hand-maintained copy of the node set, which is the parallel
  path Rule 1 forbids. With it, `KbContext.nodes` is a derived read, every
  assignment site is gone, and "a virtual node never reaches the store" is
  enforced in one place instead of remembered at three.
- **`KbContext.nodes` still exists**, as `readonly nodes: KbNode[]` backed by a
  getter over `index.storedNodes()` (cached per generation). Removing the field
  outright would mean editing `extension/ext-canvas` and `server/src/server.ts`,
  which p1b does not own; every reader compiles unchanged against the getter.
  This is the last step of p1 §2c and it is now a rename, not a redesign.
- **`KbIndexService` is used by `graph.query` and `graph.search` only.**
  Everything that needs the session as well as the index reads `ctx.index`.
  Threading the service through the rest widened the `R` channel into
  `RenderEnv` and ext-docs' `DocsEnv` — files this wave does not own — for no
  gain, since those programs need `KbCtx` anyway. The service is genuinely
  wired (it is not a dead seam) and is the access path when `KbCtx` is
  decomposed.
- **Reads stay synchronous** (p1 §2a), recorded as `#gap`
  `01M1PH06G67A9HHTTXFZVAZ3YF`.
- **Commits 3 and 4 are as the brief lists them**, but the staleness check
  needed one extra follow-up (commit 5) after p1a's review, and the deletion of
  `buildQueryDb` had to wait for p1a and p1c to reach `main` (commit 6).

## Files touched outside p1b's ownership

Each is mechanical, and each was made after that file's owner had merged to
`main` (p1b merges last):

| file | change | why |
|---|---|---|
| `contracts/src/actions.ts` | `ActionHandlerEnv` gains `KbIndexService` | one line; the service has to be admissible for a handler to use it |
| `infrastructure/store-jsonl/tests/benchmark.test.ts` (p1a) | `buildQueryDb(loaded)` → `new DatascriptIndex(loaded).handle`, `query(qdb, …)` → `index.runDatalog(…)` | the acceptance requires `buildQueryDb` to be gone |
| `domain/query/tests/{datascript,ir}.test.ts` (p1c) | same handle swap, via a local `handleFor` | same |
| `domain/query/src/datascript.ts` (p1c) | parameter type `QueryDb` → `DatascriptDb` on `executeEdn`, `datascriptExecutor`, `query`, `queryRows`, `pull` | the node map that used to travel with the handle is the index's now |

Nothing else in p1c's execution half was touched: `normalizeEdnQuery`,
`compile`, `parseEdn`, `runIr`, revival and the rules handling are as merged.

## A defect in the merged p1c code (reported, not fixed)

`rewriteChildOrderCartesian` in `datascript.ts` captures the order variable
with `(\?\S+)`, which is greedy: when the `:node/child-order` clause is the
**last** clause in the query, the capture swallows the clause's closing bracket
and the replacement leaves unbalanced EDN.

```
[:find ?id ?i :where [?p :node/id "p"] [?p :node/child ?c] [?c :node/id ?id] [?p :node/child-order ?i]]
→ DatalogError: Unexpected EOF while reading item 7 of vector
```

The same query with any clause after the child-order one is fine. Capturing
`(\?[^\s\]]+)` fixes it. Sent to the coordinator (`msg_58953f2cd260`); left for
p1c as the file's owner. p1b's own test moved off that join — order lives on
`:node/children`, which is the point of the rewrite.

## What the next wave needs to wire `run(ir)`

Small, and deliberately left:

1. **`KbIndex.run(ir)`** beside `runDatalog(edn)`. The implementation is one
   line — `runIr(datascriptExecutor(this.handle), ir, this.#ids, ...inputs)` —
   because p1c already separated compilation from execution.
2. **Delete `DatascriptIndex.handle`.** It exists only because `runIr` takes
   `(exec, ir, ids)` as arguments; once `run(ir)` is on the port, the index is
   the only thing that ever holds a db, and the two test files that use the
   handle move onto `run`. This is the one seam p1b opened on purpose and the
   grep to check it (`\.handle`) is short.
3. **Stored-form migration**: the five `sys.f.*` props and `.kb/queries/*.edn`
   hold EDN today. Every consumer now goes through the index
   (`ctx.index.runDatalog` in `docs.ts`, `ontology.ts`, `actions.ts`, the hub),
   so the migration has exactly four call sites to flip from `runDatalog(edn)`
   to `run(ir)`.
4. **`ctx.nodes` → `index.storedNodes()` at the call sites** in `ext-canvas`
   and `server/src/server.ts`, then the field goes.
5. **Phase 4 gates** can use `DatascriptIndex.rebuilds` and the table above;
   the zero-rebuild assertion already exists in `index-rebuilds.test.ts`.

## Gap nodes filed

- `01M1PH06G67A9HHTTXFZVAZ3YF` — KbIndex reads are synchronous.
- `01M1PK5NYA7ZG3XC0H0YRYRVZE` — store staleness is size+mtime, not a
  fingerprint.
