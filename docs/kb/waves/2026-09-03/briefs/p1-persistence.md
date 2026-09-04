# p1-persistence — one owner for "the current graph", JSONL stays the truth

Wave `p1` of `docs/kb/waves/2026-09-03/plan.md`. Runs after `g2` (wants the
strict flags and the Effect diagnostics) and after `d1` (does not want to
collide in `src/foundation`).

Inputs: `reports/recon-kb.md` Part B (the seam map, file:line),
`reports/recon-persistence.md` (candidates, measurements, verdicts),
`reports/measurements.md` §7. kb nodes `01M0Y1J5PHNC0KSAG4ZFKAF9P0` +
`01M0Y1J8JE6S62H9DHA325YGWT` are this work; `01M0Y1JB6E0WGF6EYMX1XG6ESD`
(binary assets / LORE VCS) is **out of scope** and stays a separate node.

## 0. Decision record (plan D3/D4, restated once here as the canonical home)

- **JSONL is the only committed source of truth.** Format unchanged: one
  canonical-JSON node per line, sorted by id, whole-file durable replace.
- **DataScript is the only query engine today, behind two boundaries.** The
  EDN dialect is public API *and* stored user data; changing it is a data
  migration *unless the stored form is kb-owned* — so this wave introduces a
  **query IR** (Phase 2f) and makes the engine an adapter. No hand-rolled
  datalog→SQL compiler, no fork of DataScript. Revisit trigger (plan D10):
  the hosted everything-KB approaches ~1 M datoms (≈120–140 k nodes, ≈400 MB
  in-process at the measured 380 B/datom), or path-as-value / shortest-path /
  bounded-depth queries become a product need (datalog returns endpoints only;
  demo in plan D3).
- **The index is derived and rebuildable.** Anything persisted beside the JSONL
  is a cache: gitignored, fingerprinted against the source, deletable at any
  time, never authoritative. Say so in the type, not in a comment.
- **Rejected with evidence** (do not re-open without new facts): CozoDB (last
  release 2023-12, maintenance unanswered), Kuzu (archived 2025-10), Mentat
  (dead; the exact datalog→SQLite blueprint), DataScript lazy `storage` from JS
  (throwing stub in 1.7.8 and 1.8.1), Logseq's fork (opaque Transit blobs;
  their own git answer is "export markdown"), Datahike/XTDB/Datalevin (JVM),
  Memgraph/Neo4j/TypeDB/SurrealDB (daemons; cannot run in the browser UI;
  BSL for two of them), PGlite (WASM Postgres per CLI invocation), DuckDB (open
  Bun crash), Automerge/Yjs (binary, undiffable, no queries), TinyBase (no
  transitive traversal), Triplit/RxDB/Electric/Zero (license, inactivity, or
  needs Postgres).

## 1. Today, in one diagram (from recon-kb B.9)

```
KbContext (mutable bag)         ctx.nodes: KbNode[]   ← assigned by services.ts, session.ts, cli.ts:401
                                ctx.qdb: QueryDb      ← db: unknown, rebuilt via d.init_db on
                                                        open, reload, persist, hub.applyNodes ×2
Store port (exists, honoured)   EffectStore { path, loadEffect(), commitEffect(tx) } → JsonlStore
                                commit = lock → full reload → merge → sort → canonical → durable replace
Index                           none — buildQueryDb(nodes) is a pure function called from 6 places
```

One interactive UI edit = reload (parse + decode + init_db) → persist (rewrite
+ init_db) → applyNodes (init_db). Three full index builds. At 231 nodes free;
at 50k ≈ 3 × 700 ms.

## 2. Target shape

```
        surfaces (CLI / MCP / HTTP / WS)          unchanged: actions + receipts
                    │
              operations / render                 unchanged API: query(edn), pull(pattern,id), getNode, allNodes, search
                    │
        ┌───────────┴────────────┐
   KbStore (exists)         KbIndex (NEW port; replaces ctx.qdb AND ctx.nodes)
   load / commit            rebuild(nodes) · applyTx(tx) · runDatalog(edn,…) · pull(pattern,id)
                            getNode(id) · allNodes() · search(text) · generation · virtual(nodes)
        │                           │
   JsonlStore               DatascriptIndex (in-memory, incremental via d.db_with, stable eids)
                              └─ optional IndexCache (derived snapshot, .kb/cache/, fingerprinted)
```

`KbContext` becomes `{ root, store: KbStore, index: KbIndex }`. The three
places that assign `ctx.qdb`/`ctx.nodes` become one `index.applyTx`. Anything
that leaves `ctx.qdb` in place *and* adds a service beside it is the parallel
path Rule 1 forbids.

## 3. Phases (each its own PR-sized commit set; each keeps the suite green)

### Phase 0 — measure and fix the doc/code drift (½ day)

- `tests/benchmark.test.ts` fails today (2267 ms vs `< 1000`). Extend it into
  a proper benchmark file that times, separately: load (parse), decode, datom
  build, one query, **one `kb set`-shaped commit**, **one interactive edit
  (reload + persist + applyNodes)**, and prints a table. Commit the numbers to
  `reports/p1-persistence.md` as the baseline. Assertions come back in Phase 4
  against measured targets, not the aspirational 1 s.
- `DESIGN.md` §Performance: replace "streaming line parse (no
  read-whole-string-then-split)" with what the code does, and with the target
  this brief sets. Fix the "conn"/"transacts deltas" wording in DESIGN.md and
  DESIGN-UI.md — there is no conn today.
- `.gitignore`: add `.kb/nodes.jsonl.lock` and `.kb/cache/` (harness check 12
  from `g2` goes red-then-green here).

### Phase 1 — batched decode (½ day, no architecture change)

`jsonl-store.ts` `decodeNodeLine`: per-line `Effect.gen` + `Effect.try` +
`mapError` → one `Effect.try` around a loop of `Schema.decodeUnknownSync`
with the line index tracked for the error. Measured 170 → 84 ms at 50k.
Keep: first bad line fails the whole load with a line-numbered `DomainError`;
`onExcessProperty: "preserve"`. Property test `store-roundtrip` must still
pass byte-identical.

Also here: `KbNodeSchema` declares `order` (optional, `exactOptionalPropertyTypes`
now on) instead of relying on excess-property preservation; `Schema.Number` →
`Schema.Finite` for `num` props (tsgo `schemaNumber`; JSON cannot carry NaN).
Both are additive to the file format.

### Phase 2 — the `KbIndex` port (2–3 days; the core of the wave)

**2a. Define the port** in `src/foundation/index/index.ts` (new directory;
`foundation/query/` keeps the pure datom builder and `normalizeEdnQuery`):

```ts
export interface KbIndex {
  readonly generation: number;                       // bumps on every applyTx/rebuild
  rebuild(nodes: ReadonlyArray<KbNode>): void;
  applyTx(tx: StoreTx): void;                         // incremental
  runDatalog(edn: string, ...inputs: ReadonlyArray<unknown>): Array<Array<unknown>>;
  pull(pattern: string, id: NodeId): unknown;
  getNode(id: NodeId): KbNode | undefined;
  allNodes(): Iterable<KbNode>;
  search(text: string, limit?: number): Array<KbNode>;
  withVirtual(nodes: ReadonlyArray<KbNode>): void;    // index-only rows (saved-query nodes)
}
export class KbIndexService extends Context.Service<KbIndexService, KbIndex>()("kb/KbIndex") {}
```

Reads stay synchronous — every current caller is inside `Effect.try` assuming
sync throw (recon-kb B.9 risk 2); making them `Effect` now is a wide mechanical
change with no consumer that needs it. Record as a `#gap` node: "reads are sync;
an async index (SQLite point reads) would need the ontology runner's injected
signature changed across three surfaces".

`withVirtual` is first-class because saved-query nodes exist in the index and
not in the store, with the resurrection rule in `services.ts:14-26`. Model it
once here; delete the ad-hoc merge in `rebuildQdb`.

**2b. `DatascriptIndex`** — the one implementation:

- Stable eids: `IdMap` stops being positional (`buildIdMap` sorts and numbers
  1..n). Allocate eids monotonically per new `NodeId`; never reuse. Persist the
  map alongside the snapshot in Phase 3. `reviveValue`/`revivePull` keep working
  because they only need eid → NodeId.
- `applyTx`: for each delete → `[:db/retractEntity eid]`; for each upsert →
  retract that entity's old datoms, add the node's new datoms (`nodesToDatoms`
  becomes per-node, `nodeToDatoms(node, ids)`, with the mentions/ref schema
  contribution returned so schema can grow). Apply with `d.db_with`. If a
  ref-typed attribute appears for the first time (schema is data-derived —
  recon-kb B.2), fall back to `rebuild` for that tx; count how often in the
  benchmark. This is the single known reason a rebuild is ever needed after
  open.
- `search` owns the substring scan (moved from `operations/index.ts:750-765`).
- `getNode`/`allNodes` own the `Map<NodeId, KbNode>` that `QueryDb.nodes` was.

**2c. Re-home the owners.** `services.ts` `openKbEffect`/`reloadEffect`/
`persistEffect` call `index.rebuild`/`index.applyTx`; `session.ts`
`applyNodes` calls `index.applyTx` with the diff it already computes and reads
`generation` instead of its own `rev`; `cli.ts:396-401` (the `kb init` bypass
that leaves `qdb` stale) goes through `persistEffect`. Delete `rebuildQdb`,
`QueryDb`, and the `ctx.qdb`/`ctx.nodes` fields. `KbStore`'s `FileSystem`
requirement moves inside the Layer (`leakingRequirements`); `loadEffect()` →
`load: Effect<…>` (`lazyEffect`).

**2d. HTTP path**: `http.ts:97-121` reloads before every action "so we don't
miss external writes". With the FSWatcher already feeding `applyNodes`, the
pre-invoke reload is the second mechanism for the same concern. Replace with a
cheap staleness check (file size + mtime, or the Phase 3 fingerprint) and
reload only when it differs. Interactive edit goes from 3 index builds to 0.

**2e. Browser**: `ui/src/ds/{datoms,db,query}.ts` mirror the backend builder
and hold two verbatim copies of `normalizeEdnQuery` (and a divergent
`MENTION_RE`). Move the pure parts (`nodeToDatoms`, `normalizeEdnQuery`,
`MENTION_RE`) behind the `@kb/*` seam so the UI imports them instead of
mirroring. `outline.store.ts applyTx` then uses the same incremental path.

**2f. Query IR — the dialect boundary (1–2 days).** Today EDN strings are
stored in five `sys.f.*` props, `.kb/queries/*.edn`, `.kb/views/*.json`, and
travel over MCP and WS. Introduce `src/foundation/query/ir.ts`: a small,
kb-owned, JSON-serialisable query representation covering exactly what stored
queries use today (enumerate them: pattern clauses over `:node/*` and `:f/*`,
joins, `:in` bindings, the `reach`-style recursive rule for closure, `pull`
patterns, count/collect aggregates). Then:

- `parseEdn(edn): IR` for the subset; `compile(ir): EdnQuery` for DataScript
  (`normalizeEdnQuery` folds into the compiler — it is dialect glue and now has
  one home). Round-trip property test: `compile(parse(edn))` is
  query-equivalent (same rows on the DST corpus).
- Stored forms migrate to IR: `sys.f.query`, `sys.f.onto.query`,
  `sys.f.targetQuery`, `sys.f.lens.query`, `sys.f.view.filter` hold IR JSON;
  `.kb/queries/<name>.edn` → `.kb/queries/<name>.json`. One migration in
  `openKbEffect` (there are two such migrations already; this is the third and
  the pattern is established), additive: unparseable EDN stays as an
  `{ raw: edn }` IR node the DataScript adapter passes through verbatim, so
  nothing breaks and the residue is greppable.
- `KbIndex.runDatalog(edn)` stays for the MCP/CLI/WS raw surface, documented as
  engine-specific; `KbIndex.run(ir)` is what operations, render, ontology, and
  the hub use. An engine adapter later implements `run(ir)` in Cypher/SQL and
  may decline `runDatalog`.
- The browser imports `ir.ts` + `compile` through `@kb/*`; the two verbatim
  `normalizeEdnQuery` copies in `ui/src/ds/` are deleted (Rule 1).

The IR carries a **type per `:find` position** (node-ref / scalar / aggregate).
Today `reviveValue` revives *any* integer that happens to be a live eid into a
`NodeId`, so `[:find ?v (count ?n) …]` returns node ids where counts should be
(reproduced on the real graph: `("doing", "01KZFWGFNZ…")` for a count of 8).
The DataScript adapter revives only ref-typed positions; the raw
`runDatalog(edn)` surface keeps today's behaviour and documents it. See the
`#todo` node filed 2026-09-03 and `reports/datalog-vs-cypher/README.md` §8.

This is the step that makes plan D10's "one adapter later" true instead of
aspirational. It is also the last moment it is cheap: five props and one
`.edn` file today.

**2g. Write `briefs/u1-ui-through-protocol.md`** for the next wave: UI reads
via subscriptions + a scoped/paged snapshot, `ui/src/ds/**` as an optional
client cache behind one interface (or deleted), browser never holds the whole
graph. `p1` does not do this work; it records the seam it leaves.

### Phase 3 — derived snapshot cache (1–2 days, opt-in; **last, and only if CLI cold start still matters**)

Plan D10 lowers this phase: a hosted, long-lived `kb` process never pays cold
start, and the CLI-as-client item in §4 removes it for interactive use. Do it
only if, after Phases 1–2, cold `kb <cmd>` on the real graph size is measured
to hurt. The design stands as written.

`IndexCache` is *not* a `Store` and *not* a `KbIndex`; it is a small
collaborator `DatascriptIndex` consults on `rebuild`:

```
.kb/cache/                      gitignored
  index.json                    { schemaVersion, datascriptVersion, sourceHash, sourceBytes, nodeCount }
  db.snapshot.json              d.serializable(db)
  ids.json                      the stable eid map
```

- `sourceHash = Bun.hash(bytes of nodes.jsonl)` + `sourceBytes` + `nodeCount`
  (three cheap checks; `Bun.hash` is not cryptographic).
- `schemaVersion` is derived from a hash of `nodeToDatoms`' source text at
  build time **and** a hand-bumped constant; a test fails when the builder
  changes without the bump. A stale layout that restores cleanly and answers
  wrongly is the one failure worse than slow.
- Read: fingerprint matches → `d.from_serializable`; else rebuild. Rebuild is
  always correct, so a missing/corrupt/skewed cache is never fatal.
- Write: after `commitEffect` succeeds, inside the same write lock, refresh the
  cache; on failure delete it.
- `KB_NO_CACHE=1` and `kb cache rebuild|clear` (one `cache` subcommand; goes
  through the action registry like everything else).
- Measured: 700 ms → 100 ms cold at 50k; ~113 ms extra per commit (whole-db
  serialise). Plain file, not a SQLite BLOB (measured slower to restore).

Ship it behind the port with one boolean in `openKbEffect` options, default
**on** for CLI/MCP (cold-start bound), irrelevant for the long-lived `kb ui`
process (which keeps its db in memory and only needs `applyTx`).

### Phase 4 — benchmarks as gates (½ day)

Assert against Phase 0's measurements with headroom, per operation, at 50k:
cold open ≤ 250 ms with cache, ≤ 900 ms without; `kb set`-shaped commit
≤ 150 ms (still a full rewrite — see "not now"); interactive edit ≤ 50 ms
(no rebuild); one tag-join query ≤ 120 ms. Numbers are the wave's to set from
its own runs; the point is that they exist and fail.

## 4. Explicitly not now (each becomes a `#gap` node with its trigger)

- **`SqliteStore` behind `KbStore`** for O(1) writes and point reads. Trigger:
  measured commit latency at real node counts hurts, or `node.get` needs to
  avoid materialising every node. It is a legitimate second `Store`
  implementation; it must be a cache (truth is committed JSONL) and the type
  must say so.
- **CLI as client of a running `kb ui`** (removes cold start entirely: ~150 ms
  of every command today is `import "effect"` + `datascript`). Separate design
  question — protocol, discovery, fallback.
- **Per-query dependency tracking** in the subscription hub (today: re-run
  every live query on every change, hash rows). DESIGN-UI.md already names it
  as a growth path; doing it with the port swap doubles the blast radius.
- **Custom git merge driver** for `nodes.jsonl` (merge by id; conflict only on
  same-node divergence; ~40 lines of Bun). ULIDs cluster new nodes at the file
  tail, so two branches creating nodes conflict on adjacent lines. Worth doing;
  not this wave.
- **FTS5 / `sqlite-vec`** as additive derived indexes (`graph.search` is a
  substring scan). Gate on Bun's FTS5 `close()` segfault (oven-sh/bun#37044).
- **Binary assets** — node `01M0Y1JB6E0WGF6EYMX1XG6ESD`.

## 5. Invariants the wave must keep (tests exist for most)

- Byte-identical JSONL round trip (`store-roundtrip.property.test.ts`) and
  byte-identical DST replay (`tests/dst`). The index owns no time and no
  identity; eid allocation is a pure function of arrival order, which the DST
  seed fixes.
- Dangling refs degrade to a string sentinel (`DANGLING_REF_DECISION`).
- `sys.*` write guard; `txIntegrityError` before every commit (the `kb init`
  bypass is removed, not exempted).
- Tests/benchmarks that build a `QueryDb` directly (`field-target`,
  `contextual-ref`, `persistence`, `benchmark`, ui `ds/query.test.ts`) migrate
  to constructing a `DatascriptIndex`. No shim that keeps `buildQueryDb`
  alive beside the index.

## 6. Acceptance

- `ctx.qdb`, `ctx.nodes`, `QueryDb`, `rebuildQdb` do not exist. `grep -rn
  "init_db"` finds exactly one call site.
- One interactive UI edit performs zero full index builds (assert with a
  counter in the benchmark).
- Cold `kb search` at 50k with cache ≤ the Phase 4 target; `KB_NO_CACHE=1`
  still correct (same rows, property test).
- Cache staleness: a test that mutates `nodeToDatoms`' source hash without
  bumping `schemaVersion` fails; a test that truncates `db.snapshot.json`
  falls back to rebuild and passes.
- `tsgo` `lazyEffect`/`leakingRequirements`/`schemaNumber` at 0.
- No stored EDN remains: `grep -c '"\[:find' .kb/nodes.jsonl` is 0 after the
  migration; `.kb/queries/*.edn` are gone; `normalizeEdnQuery` has one home
  (the DataScript compiler) and zero copies under `ui/src`.
- `briefs/u1-ui-through-protocol.md` exists with the seam `p1` left.
- `DESIGN.md` §Persistence rewritten to this brief's §0 and §2, replacing the
  Logseq-storage aspiration with the recorded rejection.
- kb nodes `01M0Y1J5PHNC0KSAG4ZFKAF9P0` and `01M0Y1J8JE6S62H9DHA325YGWT`
  flipped to `done`; the §4 items exist as `#gap` nodes under the parent.
