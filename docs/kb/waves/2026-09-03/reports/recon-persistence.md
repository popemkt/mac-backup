# kb persistence: backend-agnostic storage + a fast derived index

Recon report — 2026-09-03. Target: `tools/kb` (Bun + TS + Effect 4 beta,
`datascript` 1.7.8, JSONL source of truth at `.kb/nodes.jsonl`).

---

## 0. TL;DR

**The premise of the question is half wrong, and the measurements say so.**

kb's cold-path cost at scale is **not** storage I/O and **not** JSON parsing.
Measured on this machine (Bun 1.3.14, aarch64-darwin, 50k-node fixture):

| Stage | Cost @50k | Share |
|---|---|---|
| Read file + `JSON.parse` every line | **34 ms** | 5% |
| Effect `Schema` decode per node (kb's `decodeNodeLine`) | **~170 ms** | 24% |
| `nodesToDatoms` + `d.init_db` (`buildQueryDb`) | **~411 ms** | 58% |
| Actual datalog query | ~2–110 ms | 13% |
| **Total `JsonlStore.load()` + `buildQueryDb()`** | **~700 ms** | |

A `bun:sqlite` table holding the same 50k node documents reads back in
**27.8 ms** (vs 34.3 ms for JSONL). **Swapping the storage substrate buys ~6 ms.**
Every serious database on the candidate list would buy approximately the same
~6 ms and cost a dependency, a build story, and a query-language migration.

The two costs that actually matter are **validation** and **index
construction**, and both are fixed by *caching the built index*, not by
changing where bytes live.

The other thing the research settled: the Logseq-style architecture kb's
`DESIGN.md` points at **is not reachable from JS**. DataScript's lazy storage
protocol is a *throwing stub* in the ClojureScript target (verified on both
1.7.8 and the current 1.8.1); Logseq gets it by **maintaining a fork**, stores
Transit blobs in an opaque `kvs(addr, content, addresses)` SQLite table — and
their own community's answer to "how do I git-sync this?" is *"export markdown
and commit that instead"*. Logseq abandoned the git-diffable source of truth
kb already has (§2.4).

**Recommendation: Option C — "derived DataScript snapshot", ranked #1.**
Keep JSONL as the sole committed source of truth. Keep DataScript as the sole
query engine. Add a gitignored, content-hash-keyed **snapshot of the built
DataScript db** (via `d.serializable` / `d.from_serializable`, which the npm
build *does* export), stored either as a file or in a `bun:sqlite` sidecar.

Measured: restoring that snapshot is **100 ms** vs **700 ms** to rebuild —
a **7x** cold-start improvement, using zero new runtime dependencies, zero
query-language change, and no change to the committed file format. Verified
round-trip-correct against the real repo graph (identical rows for a
tag-join query, ref schema preserved).

**Option A (pluggable `Store`, SQLite as a node store) is ranked #2** and is
worth doing *only* for its write path: kb's `commitEffect` currently does a
full reload + full-file rewrite per commit, which at 50k costs ~300 ms of
reload before it writes anything. SQLite makes a single-node write 0.004 ms.

**Option B (second datalog engine, e.g. Cozo, with EDN→X translation) is
ranked last and should be explicitly rejected.** Cozo's last release was
**December 2023** and its "is this maintained?" issue is unanswered. The
query-language coupling is deep (kb's EDN normalizer, `queries.ts`,
`sys.f.onto.query`, `sys.f.targetQuery`, `#query` nodes, and every
`.kb/queries/*.edn` are all DataScript EDN — that is *user data*, not code).

---

## 1. Measured baseline — what kb actually costs today

All numbers from this machine, this week, this checkout.

### 1.1 The repo's own benchmark currently fails

`tools/kb/tests/benchmark.test.ts` asserts a 50k fixture loads+queries in
under 1 s. It does not:

```
[bench] nodes=50076 write=129.0ms load=1573.2ms build=584.5ms query=109.1ms total=2266.8ms
(fail) benchmark 50k > load + query well under 1s [2423.06ms]
```

That 1573 ms is inflated by `bun test` harness overhead and cold JIT; in a
plain script the same load is **290 ms** and `buildQueryDb` is **411 ms**.
Either way the stated design budget is blown, and `DESIGN.md`'s claim of a
"streaming line parse (no read-whole-string-then-split)" is **not what the
code does** — `jsonl-store.ts` calls `fs.readFileString(path)` then
`body.split("\n")`. That is a live doc/code drift worth fixing regardless of
which option is chosen.

### 1.2 Cold CLI invocation (the number that matters)

kb's CLI is a fresh Bun process per command, so per-invocation cost is the
product's real latency:

| Store size | Cold `kb search … --json` wall time |
|---|---|
| 231 nodes (this repo today) | **0.19 s** |
| 50 000 nodes | **0.71 – 1.02 s** |
| 100 000 nodes (projected, linear) | **~1.3 – 1.8 s** |

Of the 0.19 s floor, ~150 ms is **module import**, not data:

```
datascript=17.0ms  effect=95.9ms  kbQuery=6.5ms   (bun -e "1" baseline: 0.01s)
```

`effect` alone is ~100 ms of import on every single `kb` invocation. That is
a fixed tax no storage backend can remove, and at today's 231 nodes it is
~80% of the runtime. **Any performance work that ignores this is optimising
the wrong 20%.**

### 1.3 Where the data-dependent time goes

Isolating each stage over the same 50k fixture:

| Operation | Time |
|---|---|
| `JSON.parse` per line only | 15–24 ms |
| `Schema.decodeUnknownSync` loop | 84 ms |
| Flat `Effect` decode loop | 115 ms |
| **kb's shape** (`Effect.gen` + `Effect.try` + `mapError` *per line*) | **170 ms** |
| `nodesToDatoms` + `d.init_db` | **411 ms** |

Two conclusions:

1. kb pays **~7x `JSON.parse`** for schema validation, and roughly a third of
   that is pure per-line `Effect.gen`/`mapError` allocation overhead that a
   batched decode would remove for free.
2. Datom construction dominates everything else and is **rebuilt from scratch
   on every invocation**. This is the thing to cache.

### 1.4 Storage substrate comparison — the null result

Same 50k nodes, `bun:sqlite` (`node(id TEXT PRIMARY KEY, doc TEXT)`, WAL):

| Operation | JSONL | bun:sqlite |
|---|---|---|
| Bulk write all 50k | 18.0 ms | 119.8 ms |
| Read all + `JSON.parse` | 34.3 ms | **27.8 ms** |
| Read all raw (no parse) | — | 15.3 ms |
| **500 point reads by id** | n/a (must read all) | **4.0 ms** |
| **100 single-node updates** | 12.5 ms *per update* (full rewrite) | **0.4 ms total** |
| EAV `datom` table, indexed `(a,v)` lookup → 5 000 rows | n/a | **2.2 ms** |

**Reads are a wash.** The wins are exclusively (a) *partial* reads and
(b) *incremental* writes — neither of which kb's current architecture uses,
because DataScript needs the whole graph in memory anyway.

### 1.5 The write path is the unflagged problem

`JsonlStore.commitEffect` takes the write lock, then calls `loadEffect()`
(full parse + full schema validation of every node), merges, re-sorts all
nodes, re-serialises, and durably replaces the whole file.

At 50k nodes, `kb set <node> status doing` therefore costs **~300 ms of
reload + ~18 ms of rewrite** before it does anything useful — and the same
work again in the next process to read the result. At 100k it roughly
doubles. This is O(N) write amplification on an O(1) edit, and it is a
sharper scaling wall than query latency.

---

## 2. Candidate evaluation

Bun compatibility rule used throughout: Bun's Node-API support is partial, so
**native `.node` addons are a risk**, WASM is safer, and Bun built-ins are
safest. "No direct evidence" means exactly that — no guessing.

### 2.1 SQL / embedded stores

#### `bun:sqlite` (Bun built-in) — **verdict: adopt, as index/sidecar only**
- **What**: Bun's built-in synchronous SQLite driver. No install, no addon, no
  WASM. Zero compatibility risk *by construction*.
- **Query**: SQL. Datalog would have to be hand-compiled (see §3.2).
- **Bun compat**: it *is* Bun. Verified working here.
  <https://bun.com/docs/runtime/sqlite>
- **Maintenance**: ships with Bun. Two caveats found: bundled SQLite version
  is reported inconsistently across platforms
  (<https://github.com/oven-sh/bun/issues/31247>) and there is an open FTS5
  teardown segfault on `Database.close()` on macOS
  (<https://github.com/oven-sh/bun/issues/37044>) — so **do not put FTS5 on
  the critical path yet**.
- **Perf**: measured above. Point reads 8 µs, single-row updates 4 µs.
- **License**: SQLite public domain; Bun MIT.
- **Fit**: perfect as a *derived index / durability sidecar*. Poor as source
  of truth — a binary file is not git-diffable, which is kb's whole premise.

#### PGlite — **verdict: reject (over-engineered for this)**
- WASM Postgres. **Explicitly documents Bun support**; v0.4 released
  2026-03-25; very active. Apache AGE (openCypher) merged as an extension, so
  graph queries are technically available.
  <https://github.com/electric-sql/pglite> · <https://pglite.dev/extensions/>
- Best-evidenced non-builtin option. But it is a whole Postgres in WASM to
  replace a 34 ms `JSON.parse` loop, with a several-MB WASM init cost on every
  cold CLI invocation — precisely the wrong trade for a per-invocation tool.

#### libSQL / Turso — **verdict: reject (no advantage over `bun:sqlite`)**
- `tursodatabase/libsql-js` explicitly advertises Node **+ Bun** + Deno
  support (<https://github.com/tursodatabase/libsql-js>). Older
  `@libsql/client` has known Bun bugs
  (<https://github.com/oven-sh/bun/issues/18909>). The Rust rewrite
  (turso-db, ex-Limbo) is **explicitly beta** as of 2026.
- Offers nothing `bun:sqlite` doesn't, for a local single-user tool.

#### DuckDB — **verdict: reject**
- MIT, very actively developed, and its 2025–2026 `USING KEY` recursive-CTE
  work genuinely improves graph traversal
  (<https://duckdb.org/2025/05/23/using-key>). DuckPGQ (SQL/PGQ) exists but is
  a community extension pinned to specific DuckDB point releases.
- **Bun: open crash class.** `oven-sh/bun#17216` ("Bun crashes opening
  DuckDB") closed as duplicate of the still-open `#13910`. duckdb-wasm docs
  list Chrome/Firefox/Safari/Node — **no Bun**.
- Also the wrong shape: an OLAP columnar engine for a 100k-row OLTP-ish graph.

#### SurrealDB embedded — **verdict: reject**
- `@surrealdb/node` v3.0.3 (mid-2026) **explicitly claims Node/Bun/Deno**
  support with RocksDB/SurrealKV persistence
  (<https://www.npmjs.com/package/@surrealdb/node>) — the strongest vendor Bun
  claim of any native-addon candidate, but vendor-claimed and not
  independently issue-verified.
- Blocker: **BSL 1.1** (converts to Apache 2.0 four years post-release), plus
  a full SurrealQL migration. Not worth it for a personal repo tool.

### 2.2 Graph / datalog engines

#### CozoDB — **verdict: reject, effectively abandoned**
- Datalog, MPL-2.0, `cozo-node` (napi-rs) + `cozo-lib-wasm`.
- **Last GitHub release v0.7.6, 2023-12-11.** The issue literally titled *"Is
  cozo still being maintained?"* remains **unanswered**
  (<https://github.com/cozodb/cozo/issues/301>). Not archived, but no
  meaningful activity in ~2 years.
- **No direct Bun evidence.** napi-rs is only "best-effort" on Bun upstream
  with known async issues (<https://github.com/napi-rs/napi-rs/issues/2003>).
  The WASM build is essentially memory-only; persistence is a separate Rust
  feature.
- Corroborated independently: a 2026 evaluation by another team facing the
  same EAV-datalog choice states flatly that *"CozoDB (the ideal candidate) is
  unmaintained"* and that the surrounding Rust datalog ecosystem offers no
  viable **runtime** engine (Ascent and Crepe are compile-time macros, not
  queryable at runtime) —
  <https://github.com/familiar-systems/familiar/blob/main/docs/discovery/2026-04-11-datalog-vs-sql-query-layer.md>
- CozoScript is also **not** DataScript's EDN dialect, so even a healthy Cozo
  would require rewriting every stored query (§3.2).
- This was the obvious "real datalog with a persistent backend" candidate and
  it is the one that fails hardest. **Do not build on it.**

#### Kuzu → LadybugDB — **verdict: reject (too new, native addon)**
- Kuzu was acquired by Apple; **repo archived 2025-10-10** alongside its final
  v0.11.3 release
  (<https://www.theregister.com/software/2025/10/14/kuzudb_graph_database_abandoned>).
- Successor forks exist and are real: **LadybugDB**
  (<https://github.com/LadybugDB/ladybug>, MIT, community-run, dropped the
  CLA, has `ladybug-nodejs` and `ladybug-wasm`) and Vela Partners'
  `Vela-Engineering/kuzu`.
- No Bun-specific evidence; native addon; <1 year old fork; Cypher migration.

#### TypeDB — **verdict: reject, not embeddable**
- Server-only (RocksDB is embedded *inside the server*, not exposed as a
  library). Requires managing a daemon. MPL-2.0 core + enterprise tier.

#### JVM family: XTDB v2, Datomic, Datalevin, Datahike — **verdict: reject**
- All require a JVM for the engine; none has a WASM or JS build.
- Datomic has been free and Apache-2.0 since April 2023
  (<https://blog.datomic.com/2023/04/datomic-is-free.html>); XTDB v2 is active
  (v2.1.0 Dec 2025) and notably exposes **Postgres-wire / Flight SQL**, so a
  Node client can talk to it as a *server*.
- The two interesting escape hatches, noted for completeness only:
  **Datalevin** ships a GraalVM native-image CLI (`dtlv serv`, no JVM at
  runtime, port 8898) and **Datahike** has a built-in server mode. Both turn
  "one Bun process reading a git file" into "manage a daemon" — a materially
  worse operational model than what kb has, for a capability
  (recursive rules, `pull`, transitive traversal) DataScript already provides
  in-process.

### 2.3 Pure-JS datalog

#### `datascript` (incumbent) — **verdict: keep, and bump**
- **Latest npm is 1.8.1 (2026-08-15)**; 1.8.0 landed 2026-08-13. **kb pins
  `^1.7.8` (2025-10-11) and has 1.7.8 installed** — a minor version behind.
  Release cadence is ~5–10/year; actively maintained, not a dead library.
  <https://www.npmjs.com/package/datascript>
- **The critical finding of this report** — enumerating the npm build's
  actual exports:

  ```
  conn_from_datoms conn_from_db create_conn datoms db db_with default
  empty_db entity entity_db filter from_serializable index_range init_db
  is_filtered listen pull pull_many q reset_conn resolve_tempid
  seek_datoms serializable squuid squuid_time_millis touch transact unlisten
  ```

  - `storage` / `store` / `restore` / `restore_conn`: **all `undefined`** —
    **verified on both 1.7.8 and the current 1.8.1**. DataScript's lazy
    storage protocol (added in 1.4.0) is **NOT exposed in the JS build**, and
    this is not an oversight in the export list: upstream
    `src/datascript/storage.cljs` — the ClojureScript target — is a **stub
    that throws**:

    ```clojure
    (defn store ([db] (throw (ex-info "Not implemented: (storage/store db)" {}))) ...)
    ```

    `docs/storage.md` says so outright: *"only on JVM, at least for now."*
    The blocker is architectural, not clerical — DataScript's API is fully
    synchronous while every browser/JS persistence target (IndexedDB, OPFS) is
    async; tonsky's own [DataScript 2 ideas post](https://tonsky.me/blog/datascript-2/)
    proposes async storage but does not implement it, and
    [issue #358](https://github.com/tonsky/datascript/issues/358) ("How can I
    use IndexedDB for datascript?") has no maintainer answer. The one existing
    adapter, [`tonsky/datascript-storage-sql`](https://github.com/tonsky/datascript-storage-sql),
    is JVM-only.

    **This single fact rules out the Logseq-style lazy-segment architecture
    for kb without forking DataScript** (see §2.4).
  - `serializable` / `from_serializable`: **present and functional.** This is
    the whole-db snapshot API, and it is enough (see §3.3).
  - `init_db` is already used by `buildQueryDb` — kb is already on the fast
    datom path, so there is no easy win left there.
  - `listen` / `unlisten` are present, which is what the `kb ui` live-query
    hub would use for incremental invalidation.

#### `datalog-ts`, Percival, Mentat — **verdict: reject / note as prior art**
- Research-grade or dead. **Mozilla Mentat (`mozilla/mentat`, formerly
  datomish) is the directly relevant prior art**: a Datomic-like store that
  compiled Datalog queries down to SQL over an EAV table in SQLite. It was
  **discontinued** — worth knowing precisely because it is the exact thing
  Option B would be rebuilding, and Mozilla abandoned it with far more
  resources than this repo has.

### 2.4 Prior art: how Logseq DB (2.x) actually does it — and why kb can't

`DESIGN.md` cites Logseq as the model ("the new DB version persists datoms in
SQLite"). That is accurate, and the mechanism is worth knowing precisely,
because **the conclusion runs against adopting it**.

**Logseq does not use upstream `tonsky/datascript`.** `logseq/logseq`'s
`deps.edn` pins a **fork** — `github.com/logseq/datascript` — whose
`src/datascript/storage.cljs` is a *real implementation* where upstream's is a
throwing stub: `IStorage` with `-store`/`-restore`, an address counter,
per-index (EAVT/AEVT/AVET) B-tree node storage via
`persistent-sorted-set.protocol/IStorage`, a "tail" transaction log at address
`1` replayed on restore for crash consistency, and `WeakRef` bookkeeping of
live restored DBs. It is actively fixed into 2026.

**The SQLite side is one table.** From `deps/db/src/logseq/db/common/sqlite.cljs`:

```clojure
(defn create-kvs-table! [sqlite-db]
  (.exec sqlite-db
    "create table if not exists kvs (addr INTEGER primary key, content TEXT, addresses JSON)"))
```

`-store` batches `[addr data]` pairs, strips `:addresses` out of the payload,
**Transit**-serialises the rest into `content`, JSON-stringifies the child
address list into `addresses`, and does one `INSERT … ON CONFLICT(addr) DO
UPDATE` per transaction, then schedules a WAL checkpoint. `-restore` is
`select content, addresses from kvs where addr = ?`. All of it runs in a
dedicated Web Worker over **SQLite compiled to WASM, persisted to OPFS**.

**Why it's fast**: `persistent-sorted-set` is structurally shared, so a
transact only dirties B-tree nodes on the path to the change — writes are
genuinely incremental — and `d/restore-conn` reads root + tail up front and
pulls segments on demand, so load is genuinely lazy.

**Why kb cannot have it, in three independent blockers:**

1. **It requires forking DataScript.** The storage protocol is not in the
   published JS build (§2.3) and is not being ported. Logseq maintains a fork
   to get it. kb taking that on means owning a ClojureScript build of a
   database engine.
2. **The stored format is opaque.** `content` is Transit blobs keyed by an
   integer address that changes as the B-tree rebalances. There is no stable
   mapping from a node to a line, a row, or a diff hunk.
3. **Logseq's own community confirms it is not git-syncable.** The documented
   answer to "how do I git-sync a DB graph" is *not* to commit the SQLite file
   — it is to turn on **Markdown Mirror**, export markdown to disk, and commit
   *that*. See <https://github.com/logseq/docs/blob/master/db-version.md> and
   <https://chromic.org/blog/logseq-db-git-sync/>.

**Blocker 3 is the whole point.** Logseq's DB rewrite *abandoned* the
git-diffable source of truth that kb is built on, and then bolted a markdown
export back on to recover it. kb already has the thing Logseq had to
reconstruct. Copying Logseq's storage layer would be copying the half of their
architecture they had to work around.

**The adjacent option, for the record**: **Datahike** is a DataScript-lineage
engine with genuinely pluggable storage via `konserve` — including an
**IndexedDB backend for ClojureScript**
(<https://github.com/replikativ/datahike/blob/main/doc/storage-backends.md>).
It is the only "someone already solved lazy async storage for a
DataScript-shaped engine" answer that exists. It is also Clojure-native, so
integrating it into a Bun + TS + Effect codebase carries the same
cross-toolchain cost as Logseq's fork, for the same loss of git-diffability.

### 2.5 CRDT / sync / reactive

#### Automerge 3.x — **verdict: not applicable**
- Active (3.4.x, 2026), MIT, big memory win in v3 (Moby Dick 700 MB → 1.3 MB).
  <https://automerge.org/blog/automerge-3/>
- **Fatally wrong for this repo's premise**: the storage format is a custom
  *binary* columnar encoding
  (<https://github.com/automerge/automerge-binary-format-spec>). Committing it
  gives you history with a useless `git diff`, and branch merges must go
  through Automerge's API rather than `git merge`. It also has **no query
  engine at all** — you walk a JS object.
- Automerge answers "how do two people edit offline and merge?" kb answers
  that with git. Different problem.

#### Yjs — **verdict: not applicable.** Same reasoning; binary update encoding,
no query layer. Persistence providers target browsers/websocket sync.

#### TinyBase — **verdict: not applicable (but the closest near-miss)**
- MIT, actively maintained (8.x/9.x through mid-2026), and it has a
  **first-class `persister-sqlite-bun` module** built on `bun:sqlite`
  (<https://tinybase.org/api/persister-sqlite-bun/>) — the best Bun story of
  any third-party store here.
- TinyQL is a typed programmatic builder with joins/filter/aggregate but **no
  recursive/transitive traversal**. kb's backlinks, `sys.f.onto.extends` DAG
  walk, and closure resolution all need exactly that. It would replace the
  easy half of DataScript and leave the hard half.

#### Triplit — **verdict: reject.** AGPL-3.0; `@triplit/db` 1.1.10 last
published ~7 months ago; co-founder joined Supabase Oct 2025
(<https://supabase.com/blog/triplit-joins-supabase>) and Tracxn lists the
company inactive as of March 2026.

#### ElectricSQL / Zero (Rocicorp) — **verdict: not applicable.** Both are
client↔server sync layers requiring a **Postgres** upstream. Zero hit 1.0 in
2026 (<https://www.infoq.com/news/2026/06/zero-version-1/>) and is Postgres-only.
Wrong shape entirely for a single-user git-backed tool.

#### RxDB — **verdict: reject.** The production SQLite storage, memory-mapped
storage and perf optimisations are behind **RxDB Premium** (annual commercial
licence, <https://rxdb.info/premium/>). Mango queries, no graph traversal. No
confirmed Bun SQLite adapter.

### 2.6 Search add-ons (orthogonal, genuinely useful)

- **FTS5**: bundled *inside* SQLite, so no extension loading needed —
  available directly from `bun:sqlite`. Real BM25 ranking, which
  `graph.search`'s case-insensitive substring scan cannot do. **Caveat: open
  macOS segfault on `Database.close()` with FTS5 virtual tables**
  (<https://github.com/oven-sh/bun/issues/37044>) — gate on this being fixed.
- **`sqlite-vec`**: 0.1.9 (2026-03-31). The canonical repo `asg017/sqlite-vec`
  stalled and community forks (`vlasky`, `@photostructure`) picked it up;
  renewed sponsorship interest in 2026. It ships a JS loader **explicitly
  compatible with `bun:sqlite`**. **macOS caveat**: Apple's system SQLite
  disables extension loading, so `Database.setCustomSQLite()` must point at a
  homebrew libsqlite3 before any `Database` is constructed.
- Both are strictly additive derived indexes — no bearing on the source of truth.

---

## 3. Architecture options

### 3.1 Option A — pluggable `Store`, SQLite as durability/index

**Shape.** `Store` already exists and is already the right seam
(`src/foundation/storage/store.ts`): `load()` / `commit(tx)`, with
`EffectStore` as the Effect-native form. Nothing above it knows the backend.
Add `SqliteStore` alongside `JsonlStore`, plus a `kb store export|import` pair
to move between them.

**What it buys, honestly.** Reads: ~6 ms at 50k (§1.4) — nothing. The real
prize is the **write path**: single-node commits go from *full reload + full
rewrite* (~310 ms at 50k) to a single `UPDATE` (**0.004 ms**), and
`node.get`-style point reads stop requiring a full graph load.

**What it costs.** Two live formats to keep in sync; a binary file that must
never be committed; and a hard architectural mismatch — **DataScript still
wants every datom in memory**, so `load()` still returns everything and
`buildQueryDb` still burns 411 ms. Option A alone does not fix the cold path.

**Verdict: worth doing, but for write amplification, not for read speed —
and it is strictly weaker than Option C on the metric that was asked about.**
If both are done, Option C should come first.

**Note on Rule 1 (abstraction before addition).** `Store` is already the
declared abstraction and currently has exactly one implementation. Adding a
second is legitimate. But a *snapshot cache* is **not** a `Store` — it is a
derived artifact, not a source of truth, and forcing it through the `Store`
interface would be the bolt-on the repo's first rule forbids. It needs its
own small port (§3.3).

---

### 3.2 Option B — a second query engine with dialect translation

**Shape.** Compile kb's DataScript EDN into SQL over an EAV table (à la
Mozilla Mentat), or port queries to Cozo's CozoScript / Cypher / SurrealQL.

**Feasibility of translating DataScript EDN.** The mechanical part is
tractable for the subset kb generates, and there is a worked recipe. Philip
Zucker's *MiniLitelog* (<https://www.philipzucker.com/tiny-sqlite-datalog/>,
with <https://www.philipzucker.com/compose_datalog/>) reduces it to: rule
**head → `INSERT OR IGNORE INTO …`**, rule **body → `FROM` / `WHERE`** (joins
plus filters); **set semantics** enforced by declaring every relation column
as a composite `PRIMARY KEY`; **semi-naive evaluation** done cheaply by using
SQLite's own `rowid` as an implicit timestamp (`WHERE rowid > last_seen`)
instead of maintaining delta tables; and the fixpoint loop itself running
*outside* SQL, re-executing rules until no new rows land. See also
`philippkueng/datalite`.

The index schema to imitate is Datomic's
(<https://docs.datomic.com/indexes/index-model.html>): **EAVT**
(entity-centric), **AEVT** (attribute-centric), **AVET** (value lookup, built
only for indexed/unique attrs since it is the most expensive to maintain), and
**VAET** (reverse-reference — "who points at X", built only for ref-typed
attrs). For kb that means at minimum composite indexes on `(e,a,v)` and
`(a,v,e)`, plus a VAET-shaped one for `:node/mentions` and every `:f/…` ref
attribute, since backlinks are a hot path.

Measured here on a `datom(e,a,v,ord)` table with `(e,a)` and `(a,v)` indexes:
an `(a,v)` lookup returning 5 000 rows takes **2.2 ms** with **zero** build
cost — genuinely fast, and it is exactly why this option is tempting.

**Where the coupling bites — and it bites hard.** The EDN in kb is not an
implementation detail confined to a query module. It is **user data and public
contract**, in at least seven places:

1. `graph.query` — an action whose input is arbitrary caller-authored EDN,
   exposed over **MCP to agents**.
2. `.kb/queries/*.edn` — saved queries, explicitly documented as *"data, not
   code"* and *"travel with the repo's data dir"*.
3. `sys.f.onto.query` — an ontology's EDN membership definition, stored as a
   **prop value on a node**, i.e. inside `nodes.jsonl` itself.
4. `sys.f.targetQuery` — ref-field target constraints, likewise a prop value.
5. `#query` nodes — a `sys.f.query` EDN prop rendered live in the UI.
6. `src/foundation/query/queries.ts` — the shared `backlinksQuery`, read by
   the browser through `@kb/queries`.
7. `normalizeEdnQuery` — kb's own `:attr` → `":attr"` rewriter, plus
   `reviveValue` mapping integer eids back to NodeIds.

Points 3, 4 and 5 are decisive: **committed graph data contains DataScript
EDN**. Changing the engine is a *data migration*, not a code change, and any
partially-supported dialect silently breaks stored ontologies and query nodes.

Beyond that, the full-fidelity surface is large: rules (`:rules`),
`:in` bindings, aggregates, `pull` (`kb get --depth N`), `d.entity`,
`index_range`/`seek_datoms`, cardinality-many ref semantics, and the
unique-identity schema on `:node/id`. A partial datalog→SQL compiler that
handles 80% is worse than no compiler, because it reads as covered.

**Maintenance reality check.** The only mature embeddable datalog engine on
the list — Cozo — has not shipped since **December 2023** and does not answer
its own maintenance issue. **Mozilla's Mentat** (formerly Datomish) is the
canonical implementation of precisely this idea — *"what if an SQLite database
could store arbitrary relations, for arbitrary consumers, without them having
to coordinate an up-front storage-level schema?"*
(<https://mozilla.github.io/mentat/about/>) — a Datomic-flavoured Datalog
compiled to SQL over SQLite, first in ClojureScript then rewritten in Rust for
Firefox and mobile. Its repo title is now literally **"UNMAINTAINED"**. Mozilla
had more resources for this than this repo does, and stopped. There is no
healthy destination.

**Verdict: reject.** This is the option that trades a working, maintained,
in-process datalog engine for a hand-rolled compiler against an unmaintained
target, and puts committed user data at risk to do it. Name the gap and stop.

---

### 3.3 Option C — **derived DataScript snapshot** (recommended)

**Core idea.** JSONL stays the *only* committed source of truth and the only
thing `Store` owns. The expensive part — the built DataScript db — becomes a
**rebuildable, gitignored, content-addressed cache**.

**This is not speculative.** `d.serializable` / `d.from_serializable` are
present in the npm build (§2.3) and were measured end-to-end here:

| Step | 50k nodes |
|---|---|
| **Rebuild path (today)**: `load()` + `buildQueryDb()` | **~700 ms** |
| `d.serializable(db)` | 35.9 ms |
| `JSON.stringify` → 11.5 MB | 76.6 ms |
| — *snapshot write total* | **~113 ms** |
| `JSON.parse` | 58.5 ms |
| `d.from_serializable` | 42.1 ms |
| — **restore path total** | **~100 ms** |
| (same snapshot as a `bun:sqlite` BLOB) read | 3.1 ms + 121.7 ms parse |

**~7x faster cold start, no new runtime dependency, no format change, no
query-language change.**

**Correctness verified** on the real repo graph (231 nodes): a tag-join query
(`[:find ?id ?t :where [?n ":f/sys.f.type" ?tag] [?tag ":node/text" "todo"] …]`)
returned **byte-identical rows** from the restored db and the freshly built
one — so `from_serializable` preserves the ref-valued schema that
`nodesToDatoms` installs, which is the thing that could plausibly have broken.

**Staleness protocol.** Keep it dumb and fail-safe:

```
.kb/cache/               # gitignored, whole directory
  index.json             # { schemaVersion, sourceHash, nodeCount, builtAt, kbVersion }
  db.snapshot.json       # d.serializable output
  nodes.sqlite           # optional (Option A) — point reads for pull/get
```

- `sourceHash` = `Bun.hash` over the exact bytes of `nodes.jsonl`
  (`Bun.hash` is already used in kb for change detection, per `DESIGN.md`).
- `schemaVersion` bumps whenever `nodesToDatoms` changes shape — **this is the
  one that will bite if forgotten**, because a stale datom layout restores
  cleanly and answers wrongly. Derive it from a hash of the datom-builder
  source or a hand-bumped constant with a test that fails when the builder
  changes.
- **On read**: hash the source file; if `sourceHash` and `schemaVersion` match,
  restore; else rebuild. A rebuild is *always* correct, so a corrupt, absent,
  truncated, or version-skewed cache is never fatal — just slower.
- **On write**: commit to JSONL first (unchanged, still under the existing
  write lock), then refresh the cache **inside the same lock**. If the refresh
  fails, delete the cache; the next reader rebuilds.
- **`--no-cache` / `KB_NO_CACHE=1`** escape hatch, and `kb cache rebuild|clear`.
- Add `.kb/cache/` to `.gitignore` — alongside the already-noted gap that
  `nodes.jsonl.lock` is *not* gitignored today (fix that too).

**Why this respects Rule 1.** It adds exactly one concept — *"the query index
is derived and rebuildable"* — with one owner. It does not fork `Store`, does
not add a second query path, does not add a second source of truth, and
deletes nothing. The rebuild path stays the definition of correct; the cache
is only ever an optimisation of it.

**Known limits, stated plainly.**
- The snapshot is whole-db. There is **no incremental datom update** and no
  lazy segment loading, because `datascript.storage` is not exposed to JS
  (§2.3). Every commit re-serialises the whole db (~113 ms at 50k). That is
  fine up to ~100k; beyond that, revisit.
- 11.5 MB of JSON at 50k → ~23 MB at 100k. Storing it as a `bun:sqlite` BLOB
  is measurably *not* faster to restore (121.7 ms vs 100.6 ms — SQLite's read
  is 3 ms but you still pay the same `JSON.parse`), so **prefer a plain file**
  unless the sqlite sidecar is being added anyway for Option A.
- `QueryDb` also carries `ids: IdMap` and `nodes: Map<NodeId, KbNode>`. The
  IdMap must be snapshotted alongside (it is small — 7.3 KB for 231 nodes,
  ~1.5 MB at 50k). The `nodes` map is only needed for pull/`node.get`; that is
  exactly where a `bun:sqlite` point-read sidecar (4 ms / 500 reads) earns its
  place, letting the snapshot restore without materialising every `KbNode`.

---

### 3.4 Option D — the cheapest win of all: stop paying cold start

Not on the original list, but it dominates every option above on effort/reward
and should be evaluated first.

At 231 nodes, kb's cold CLI is **0.19 s, of which ~0.15 s is importing
`effect`** (95–118 ms) and `datascript` (17–18 ms). No storage change touches
this. At today's scale it is ~80% of every command's latency.

Two independent moves:

1. **Batch the decode.** Replace the per-line `Effect.gen` + `Effect.try` +
   `mapError` in `decodeNodeLine` with a single batched decode (or
   `Schema.decodeUnknownSync` inside one `Effect.try`), preserving the
   line-numbered error by tracking the index. Measured: **170 ms → 84 ms** at
   50k, for a localised change with no architectural consequence. Also fix the
   `readFileString`+`split` vs the documented "streaming line parse" drift.
2. **Make the CLI a client of the already-existing server.** `kb ui` is
   already a long-lived `Bun.serve` process with a subscription hub and an
   `/api/action` endpoint composing `invokeReceiptEffect`. A CLI that detects
   a running instance and POSTs the action to it pays **zero** load, zero
   datom build, and zero `effect` import — it needs only a socket. This makes
   *every* scaling question moot for interactive use, and Option C then covers
   the cold/no-server case. `d.listen` (exported, §2.3) is the hook for
   keeping the server's db incrementally current.

---

## 4. The git-friendliness question: JSONL layouts

kb's current choice — **one canonical-JSON node per line, sorted by id, sorted
keys, whole-file replace** — is already the right one. The alternatives and
why they lose:

| Layout | Diff quality | Merge behaviour | Verdict |
|---|---|---|---|
| **Snapshot JSONL, sorted by id, canonical keys** (current) | One changed line per changed node; a new node inserts one line at its sorted position | Line-level 3-way merge works *per node*. Two edits to **different** nodes auto-merge. Two edits to the **same** node conflict — correctly, since that is a real semantic conflict | **Keep** |
| Append-only JSONL log + tombstones + compaction | Every edit appends; `git diff` shows only additions | `merge=union` makes concurrent appends conflict-free — but union merge *"does not know what a record is; it knows what a line is"*, so an update landing next to an append keeps **both** the old and the new record. Compaction then rewrites everything, producing a giant diff and destroying the benefit | Reject — trades honest conflicts for silent duplicates |
| One file per node (`.kb/nodes/<id>.json`) | Perfect isolation; zero cross-node conflicts | Best merge story of all | Reject — 100k inodes, `git status` and checkout cost explode, and directory listing becomes the load bottleneck. Also loses the sorted-scan property |
| Automerge binary doc | `git diff` useless | git cannot merge it; merges must go through Automerge's API | Reject (§2.4) |

**Practical hardening for the current layout**, worth adding regardless:

- **ULID ids sort by creation time**, so new nodes append near the end of the
  file and concurrent creations from two branches land in adjacent lines —
  the classic conflict hotspot. A `.gitattributes` entry is tempting but
  `merge=union` is the wrong tool here for the reason above. Better: a
  **custom merge driver** that parses both sides as JSONL, merges by `id`
  (last-writer-wins per node, conflict only on same-id divergence), and
  re-sorts. That is ~40 lines of Bun and turns "same file touched" into
  "same *node* touched", which is the honest granularity. Cf. structural
  merge drivers like Mergiraf and `git-json-merge` for the same idea applied
  to JSON.
- Canonical key order and stable id sort are what make this viable at all —
  both are already implemented (`canonical.ts`, the sort in `commitEffect`).
  **Guard them with a test**, since a non-deterministic key order would
  silently turn every commit into a whole-file diff.

**On the "event-sourced log + derived index" pattern generally**: it is the
right pattern *here*, but with the log being the **snapshot** file, not an
append log. kb's data has no need for history replay — git already stores every
prior state, addressable, mergeable, and with authorship. Re-implementing an
event log inside a git-tracked file duplicates the mechanism git provides.

---

## 5. Comparison table

| Candidate | Kind | Query lang | Bun compat (evidence) | 2026 status | License | Fit | Verdict |
|---|---|---|---|---|---|---|---|
| **`bun:sqlite`** | Embedded SQL | SQL | **Built-in — no addon, verified here** | Ships with Bun; FTS5 macOS segfault open; SQLite version reporting inconsistent | Public domain / MIT | Index + write sidecar | **Adopt (index only)** |
| **`datascript`** | In-mem datalog | EDN datalog | Pure JS, verified | **1.8.1 (2026-08-15)**; kb pins 1.7.8 | EPL-1.0 | Query engine (incumbent) | **Keep + bump** |
| `d.serializable` snapshot | Derived cache | n/a | Verified: 100 ms restore @50k | Part of datascript | EPL-1.0 | **Derived index** | **Adopt** |
| `datascript.storage` (lazy) | Persistence protocol | n/a | **Not exported by the JS build; CLJS impl is a throwing stub** — verified on 1.7.8 *and* 1.8.1 | JVM-only upstream | EPL-1.0 | — | **Unavailable** |
| Logseq's datascript fork + SQLite `kvs` | Lazy datom storage | EDN datalog | Requires forking DataScript; SQLite-WASM/OPFS in a Worker | Actively maintained *by Logseq* | EPL-1.0 | source of truth | **Reject — opaque, not git-syncable (§2.4)** |
| Datahike + konserve (IndexedDB) | Datalog + pluggable storage | EDN datalog | Clojure/CLJS toolchain, not an npm package | Active | EPL | source of truth | **Reject — cross-toolchain cost** |
| Mentat (datalog→SQLite) | Prior art | Datalog | — | **UNMAINTAINED** (Mozilla) | Apache-2.0 | — | **Dead — but the exact Option B blueprint** |
| datalog-ts / Percival | Pure-JS datalog | Datalog | Pure JS / WASM | Hobby / notebook research grade | MIT | — | **Reject (immature, no storage)** |
| CozoDB | Embedded datalog | CozoScript | No direct evidence; napi-rs "best-effort" on Bun | **Last release 2023-12-11; maintenance issue unanswered** | MPL-2.0 | would be source of truth | **Reject — abandoned** |
| Kuzu | Embedded graph | Cypher | n/a | **Archived 2025-10-10** (Apple acquisition) | MIT | — | **Dead** |
| LadybugDB (Kuzu fork) | Embedded graph | Cypher | No Bun evidence; native addon | Active but <1 yr old | MIT | possible index | **Reject (immature)** |
| DuckDB | Embedded OLAP | SQL + recursive CTE / DuckPGQ | **Open crash issue #17216→#13910**; wasm docs omit Bun | Very active | MIT | index only | **Reject** |
| libSQL / Turso | Embedded SQL | SQL | `libsql-js` claims Bun; `@libsql/client` has Bun bugs | libSQL stable; turso-db **beta** | MIT | — | **Reject (no gain over builtin)** |
| SurrealDB embedded | Embedded multi-model | SurrealQL | Vendor claims Node/Bun/Deno; unverified | Active, v3.0.3 | **BSL 1.1** | source of truth | **Reject (licence + migration)** |
| PGlite | WASM Postgres | SQL (+AGE Cypher) | **Explicitly documents Bun** | Very active, v0.4 Mar 2026 | Apache-2.0 | either | **Reject (overkill / WASM init per invocation)** |
| TypeDB | Server DB | TypeQL | Not embeddable | Active | MPL-2.0 + ent. | — | **Reject** |
| XTDB v2 / Datomic / Datalevin / Datahike | JVM datalog | Datalog | **JVM only** (Datalevin has GraalVM `dtlv serv`; Datahike has server mode) | All active | MPL / Apache-2.0 / EPL | sidecar daemon only | **Reject (operational model)** |
| Automerge 3.x | CRDT doc | none | WASM; install docs only | Active, 3.4.x | MIT | — | **N/A — binary, undiffable, no queries** |
| Yjs | CRDT doc | none | Pure JS core | Active, 13.6.x | MIT | — | **N/A** |
| TinyBase | Reactive store | TinyQL (builder) | **`persister-sqlite-bun` is first-class** | Active, 8.x/9.x | MIT | index | **Reject — no transitive traversal** |
| Triplit | Sync DB | builder | — | **Company inactive Mar 2026; last publish ~7 mo** | **AGPL-3.0** | — | **Reject** |
| ElectricSQL / Zero | Sync layer | SQL / ZQL | — | Active; Zero 1.0 2026 | Apache / — | — | **N/A — requires Postgres server** |
| RxDB | Client DB | Mango | Unconfirmed for SQLite storage | Active | **Premium tier for SQLite** | — | **Reject** |
| FTS5 | Search index | SQL/MATCH | In `bun:sqlite`; **open macOS close() segfault** | In SQLite core | Public domain | derived index | **Adopt later (gate on bug)** |
| `sqlite-vec` | Vector index | SQL | JS loader explicitly supports `bun:sqlite`; **macOS needs `setCustomSQLite`** | 0.1.9 Mar 2026; forks carry it | Apache-2.0/MIT | derived index | **Optional, if semantic search is wanted** |

---

## 6. Ranked recommendation

0. **Bump `datascript` 1.7.8 → 1.8.1** and re-run the 50k benchmark before
   anything else — two minors of upstream work land for free, and it re-baselines
   every number below.
1. **Option D.1 — batch the schema decode** (170 → 84 ms @50k). Hours of work,
   no architecture change, no new concept. Do this regardless.
2. **Option C — derived DataScript snapshot cache** (700 → 100 ms @50k).
   The headline recommendation. One new concept, one owner, always
   rebuildable, JSONL unchanged and still the only committed truth.
3. **Option A — `SqliteStore` behind the existing `Store` port**, specifically
   to kill the O(N) reload-and-rewrite in `commitEffect`, and to give
   `node.get` a point-read path. Do this *after* C, and only if write latency
   is actually observed to hurt.
4. **Option D.2 — CLI-as-client-of-`kb ui`**. Highest ceiling (removes cold
   start entirely for interactive use), but the largest surface change; treat
   as a separate design question.
5. **FTS5 / `sqlite-vec`** as additive derived indexes once (3) exists and the
   Bun FTS5 segfault is resolved.
6. **Option B — second engine + dialect translation. Do not do.**

---

## 7. Risks

**Against Option C (the recommendation):**

- **Stale cache answering wrongly** is the one failure mode that is worse than
  slow. Mitigation: `schemaVersion` derived from the datom-builder, plus a
  test that fails when `nodesToDatoms` changes without a bump. Do not rely on
  remembering.
- **Hash collision / partial write.** `Bun.hash` is not cryptographic; a
  truncated `nodes.jsonl` write mid-commit could in principle hash-match. The
  existing durable-replace + write-lock make this very unlikely, and pairing
  the hash with `nodeCount` and file size makes it negligible. Write the cache
  inside the same lock.
- **Snapshot format is a datascript internal.** `serializable`/
  `from_serializable` are public API but the payload shape is not a stable
  contract across datascript majors. Mitigation: include the datascript
  version in `index.json` and invalidate on change. Cheap, because rebuild is
  always available.
- **Memory.** 11.5 MB JSON at 50k → ~23 MB at 100k, and `JSON.parse` peaks at
  roughly 2–3x that. Acceptable, but it is the ceiling that eventually forces
  the lazy-storage question — which JS DataScript cannot answer today.
- **It does not help writes at all.** Every commit still re-serialises the
  whole db. Below ~100k this is ~200 ms; above it, this becomes the wall.

**Against the status quo (doing nothing):**

- The repo's own 50k benchmark is **already failing**, and `DESIGN.md`
  documents a streaming loader that does not exist. The stated performance
  requirement is currently unmet and unguarded.
- Write amplification (§1.5) scales worse than read latency and is not
  currently measured by any benchmark. Add one.

**Against Option A:**

- Two source-of-truth-shaped things is exactly the "parallel path" Rule 1
  forbids unless the snapshot/store distinction is kept crisp. `SqliteStore`
  must be *either* the truth *or* the cache, never ambiguously both — and
  since the truth must be git-committed, it can only ever be the cache. Say so
  in the type, not in a comment.
- `bun:sqlite`'s bundled-SQLite version is reported inconsistently across
  platforms (Bun #31247); pin behaviour tests rather than trusting release notes.

**Ecosystem risk, general:**

- The embedded-datalog niche is **shrinking, not growing**: Cozo stalled in
  2023, Kuzu was acquired and archived in 2025, Mentat died years ago, Triplit's
  company is listed inactive. DataScript's in-process, dependency-free,
  pure-JS position is unusually durable *because* it is small and boring. The
  strategic move is to depend on less of the ecosystem, not more.
- Conversely, `datascript` itself is a single-maintainer ClojureScript project
  whose JS build is a secondary artifact (which is exactly why `storage` is
  missing from it). That is the standing risk of the incumbent — worth a note
  in `DESIGN.md`, not worth acting on today.

---

## 8. Sources

- DataScript — <https://github.com/tonsky/datascript> · npm <https://www.npmjs.com/package/datascript> (1.7.8)
- Bun SQLite — <https://bun.com/docs/runtime/sqlite> · <https://bun.com/reference/bun/sqlite>
- Bun FTS5 segfault — <https://github.com/oven-sh/bun/issues/37044>
- Bun bundled SQLite version — <https://github.com/oven-sh/bun/issues/31247>
- Bun `node:sqlite` not implemented — <https://github.com/oven-sh/bun/discussions/27092>
- CozoDB — <https://github.com/cozodb/cozo> · maintenance issue <https://github.com/cozodb/cozo/issues/301>
- Kuzu archived — <https://www.theregister.com/software/2025/10/14/kuzudb_graph_database_abandoned>
- LadybugDB — <https://github.com/LadybugDB/ladybug> · <https://github.com/LadybugDB/ladybug-nodejs>
- DuckDB/Bun crash — <https://github.com/oven-sh/bun/issues/17216> · DuckDB `USING KEY` <https://duckdb.org/2025/05/23/using-key>
- libSQL for Bun — <https://github.com/tursodatabase/libsql-js> · Bun bundling issue <https://github.com/oven-sh/bun/issues/18909>
- SurrealDB node/Bun — <https://www.npmjs.com/package/@surrealdb/node> · licence <https://surrealdb.com/license>
- PGlite — <https://github.com/electric-sql/pglite> · extensions <https://pglite.dev/extensions/> · v0.4 <https://electric.ax/blog/2026/03/25/announcing-pglite-v04>
- Automerge 3 — <https://automerge.org/blog/automerge-3/> · binary format <https://github.com/automerge/automerge-binary-format-spec>
- TinyBase Bun persister — <https://tinybase.org/api/persister-sqlite-bun/> · TinyQL <https://tinybase.org/guides/using-queries/tinyql/>
- Triplit → Supabase — <https://supabase.com/blog/triplit-joins-supabase>
- Zero 1.0 — <https://www.infoq.com/news/2026/06/zero-version-1/>
- RxDB Premium — <https://rxdb.info/premium/>
- Datomic free/Apache-2.0 — <https://blog.datomic.com/2023/04/datomic-is-free.html>
- Datalevin — <https://github.com/datalevin/datalevin> · Datahike <https://github.com/replikativ/datahike> · XTDB v2 <https://xtdb.com/blog/launching-xtdb-v2>
- sqlite-vec — <https://alexgarcia.xyz/sqlite-vec/js.html> · maintenance <https://github.com/asg017/sqlite-vec/issues/226>
- FTS5 — <https://www.sqlite.org/fts5.html>
- git union-merge caveat on JSONL — <https://dev.to/rulestack/two-writers-one-append-only-ledger-the-git-conflict-one-gitattributes-line-fixed-and-the-files-55j0>
- JSON merge drivers — <https://github.com/jonatanpedersen/git-json-merge>
- DataScript storage protocol (JVM-only) — <https://github.com/tonsky/datascript/blob/master/docs/storage.md> · IndexedDB issue <https://github.com/tonsky/datascript/issues/358> · DataScript 2 ideas <https://tonsky.me/blog/datascript-2/> · JVM SQL adapter <https://github.com/tonsky/datascript-storage-sql>
- Logseq DB storage — fork <https://github.com/logseq/datascript> · db-version docs <https://github.com/logseq/docs/blob/master/db-version.md> · git-sync workaround <https://chromic.org/blog/logseq-db-git-sync/>
- Datahike storage backends (konserve, IndexedDB) — <https://github.com/replikativ/datahike/blob/main/doc/storage-backends.md>
- Mentat (UNMAINTAINED) — <https://github.com/mozilla/mentat> · <https://mozilla.github.io/mentat/about/>
- Datalog→SQLite pattern — <https://www.philipzucker.com/tiny-sqlite-datalog/> · <https://www.philipzucker.com/compose_datalog/> · <https://github.com/philippkueng/datalite>
- Datomic index model (EAVT/AEVT/AVET/VAET) — <https://docs.datomic.com/indexes/index-model.html> · <https://tonsky.me/blog/unofficial-guide-to-datomic-internals/>
- Cozo unmaintained (independent 2026 eval) — <https://github.com/familiar-systems/familiar/blob/main/docs/discovery/2026-04-11-datalog-vs-sql-query-layer.md>
- datalog-ts — <https://github.com/vilterp/datalog-ts> · Percival <https://github.com/ekzhang/percival>

