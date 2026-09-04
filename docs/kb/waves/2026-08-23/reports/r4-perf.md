# r4 — kb storage and performance architecture

Research only; no implementation is included in this report.

## Executive conclusion

The current JSONL design is safe against many ordinary **process** crashes because a
commit writes a temporary file and atomically renames it over the live file. It is not
database-grade durable or concurrent:

- acknowledged writes are not forced to stable storage (`fsync`/directory sync are
  absent);
- there is no lock, compare-and-swap revision, or single writer, so concurrent
  read-modify-rewrite commits can silently lose valid writes;
- the backup is one unverified copy, is overwritten before replacement, and has no
  automatic recovery path;
- one changed node costs an O(N) load, canonical serialization, backup copy, and
  rewrite;
- the server and browser rebuild complete DataScript databases on every delta, and
  every live subscription is rerun separately for every client.

The recommended destination is **SQLite in WAL mode as the authoritative store**, via
Bun's built-in `bun:sqlite`, with `synchronous=FULL`, a persistent monotonic revision,
application-level optimistic concurrency, and a single-writer broker for all normal
surfaces. Keep canonical JSONL as a revision-stamped portable export and rollback
artifact. Do not commit or Mackup-copy a live SQLite main file alone; produce a
consistent immutable SQLite backup with SQLite's backup mechanism or `VACUUM INTO`,
then back up that artifact.

SQLite solves storage durability and transactional concurrency, but **SQLite alone does
not solve the million-node query/UI problem**. DataScript remains fully in memory. The
query path must also move to a server-owned incremental model: first incremental
DataScript transactions and shared subscription evaluation, then a SQLite-backed
Datalog adapter (or an explicitly bounded hot DataScript cache) before one million
realistic nodes. The browser should never receive or index the entire million-node
graph.

## Current-state analysis

### Persistent write path

`JsonlStore.commitEffect` currently performs this sequence for every transaction:

1. Read and validate all of `.kb/nodes.jsonl` with `readFileString` and
   `body.split("\n")`.
2. Build a `Map` of every node, then apply transaction upserts/deletes.
3. Sort every node by id and build one canonical JSON string for the whole graph.
4. Write `nodes.jsonl.<pid>.<time>.tmp`.
5. Copy the current live file over `nodes.jsonl.bak`.
6. Rename the temporary file over `nodes.jsonl`.

The design document says streaming load, but the implementation reads and splits the
whole file. A commit also holds several representations concurrently: decoded nodes,
the id map, sorted node array, canonical strings/body, and (in long-lived processes) the
prior DataScript database.

There is no `fsync`, `fdatasync`, directory sync, file lock, lease, persistent store
revision, checksum, or recovery scan. Temporary artifacts and the backup are ignored by
Git. Load fails closed on malformed or schema-invalid lines and preserves unknown own
JSON fields, both of which are good data-preservation properties.

### Surface behavior and duplicate work

- **CLI:** each command opens a fresh context (load + DataScript build). A mutation's
  store commit loads the file again, rewrites it, and then builds DataScript again.
- **MCP:** one mutable context is shared by the long-lived server. Each tool invocation
  reloads it. Concurrent request handlers are not serialized.
- **UI HTTP:** each action reloads first; a mutation then loads/re-writes again, rebuilds
  DataScript in `persistEffect`, and rebuilds it again in `hub.applyNodes`. The later
  filesystem-watch event reloads/builds yet again before the content hash no-ops the
  broadcast. Thus one UI mutation can cause three file reads and four full DataScript
  builds.
- **Filesystem observation:** the server watches the live file inode when it exists.
  Atomic replacement can have platform-specific watcher behavior; the directory is
  watched only when the initial file watch fails. The watch is best effort and errors
  are discarded.

The in-process mutations of `ctx.nodes`, `ctx.qdb`, and the subscription hub are only
atomic in the narrow JavaScript sense. Await points around reload and commit permit two
HTTP/MCP actions to interleave. Independent CLI processes have no coordination at all.

### Query and browser path

The server assigns integer DataScript entity ids by sorting all current node ids. It
materializes approximately:

- four metadata datoms per node (`id`, `text`, `created-at`, `updated-at`);
- property value datoms;
- mention datoms;
- up to three representations per child edge (`child`, `child-order`, and the
  `children` vector).

The sorted, ephemeral entity-id assignment means inserting a node can shift many eids;
it is unsuitable for true incremental transactions until eids become stable.

The browser holds at least three graph representations:

1. `wireNodes`, the complete wire snapshot;
2. a complete outline `Map` with derived parent/state data;
3. a complete client DataScript database.

`applyTx` merges even a one-node delta into the full array, rebuilds the complete
outline map, and rebuilds the complete DataScript database. A revision gap refetches
`GET /api/graph`, which serializes, transfers, validates, and rebuilds the entire graph.

On the server, `SubscriptionHub.applyNodes` sorts and serializes the full node set for a
content hash, compares every node, rebuilds the full DataScript database, then reruns
every subscription of every client. Identical query text subscribed by 100 clients is
evaluated and hashed 100 times. Changed query results are sent as complete row sets,
not deltas.

### Current backup boundary

The brief describes `.kb/` as Mackup-backed, but the repository's declared policy is
more specific:

- `.kb/nodes.jsonl`, queries, and views are committed source-of-truth data;
- only `.kb/assets` is Mackup-owned and copied to iCloud;
- local databases are otherwise regular-backup concerns.

That distinction must be resolved before a binary database becomes authoritative. A
live SQLite file in WAL mode is a multi-file live state (`db`, `db-wal`, `db-shm`) and
must not be copied casually. A generated, immutable backup artifact is the appropriate
Mackup/regular-backup input.

## Failure modes

### Crash point analysis of the current commit

| Crash/failure point | Expected outcome today | Gap |
|---|---|---|
| Before or during temp write | Live file remains old; partial temp may remain | No cleanup/recovery inventory; no checksum |
| After temp write, before backup | Live file remains old | Temp is not known durable |
| During backup copy | Live remains old; `.bak` may be partial/corrupt | Previous recovery copy can be destroyed |
| After backup, before rename | Live remains old, backup is old, temp is candidate new | No startup logic chooses/validates candidate |
| During rename on same filesystem | Namespace replacement should expose old or new, not a half name | Atomic visibility is not durable persistence |
| After rename, before process return | Usually new live file | No file or parent-directory sync |
| After successful return, then OS/power loss | New commit may be lost/reverted; filesystem/device dependent | Acknowledged write is not guaranteed durable |
| Disk full during temp write | Commit fails; live likely intact | Temp remains; backup/recovery state unclassified |
| Disk full during backup | Commit fails; live intact, backup possibly damaged | Last known recovery copy lost |
| Malformed live file on next load | Entire load fails with line number | No automatic verified fallback to backup |

Atomic rename protects readers from seeing a half-written **live pathname**. It does not
make preceding data writes or the directory entry stable across power loss. A
dependency-free durable replacement needs, at minimum: write the candidate through an
open file descriptor, sync it, validate it, atomically rename it, sync the parent
directory, and only then acknowledge. The prior generation must be rotated without
destroying the last verified snapshot first.

On Darwin, strict power-loss testing must also account for the distinction between
ordinary `fsync` and `F_FULLFSYNC`/device-cache flush behavior. The current Effect/Bun
file abstraction does not express that intent. This platform-specific edge is another
reason to prefer SQLite's tested VFS path over a hand-rolled durability protocol.

### Lost-update examples

1. Writer A and writer B both load revision R.
2. A computes node/parent changes; B computes other changes.
3. Both enter `commitEffect` and can both load the same live R before either rename.
4. Each writes a complete R+own-change file.
5. Whichever rename happens last silently erases the other acknowledged transaction.

Even when B's inner commit load sees A's replacement and therefore merges distinct
upserts, B's operation was computed from a stale `ctx.nodes`. Edits to the same node,
parent child ordering, moves, deletes, tag field lists, and unset/set operations are
last-writer-wins with no conflict report. A filesystem lock around only rename is not
enough; it must cover the authoritative read, validation, mutation, and durable commit.

### Undetected logical corruption

Checks today catch malformed JSON and known-field type errors. They do not detect:

- duplicate ids in JSONL (later maps can collapse them);
- an old but syntactically valid whole-file replacement;
- missing acknowledged transactions;
- invalid timestamps, dangling refs/children, duplicate child membership, or cycles;
- a valid file paired with the wrong backup or temporary file.

Some graph anomalies may be intentionally allowed (for example dangling refs), so an
integrity checker should distinguish hard invariants from warnings rather than silently
"repairing" data.

### What crash-proof JSONL would require

If no storage engine is used, whole-file rename can be hardened but remains O(N). A
database-like custom design needs a framed write-ahead log plus snapshots:

#### WAL frame

Each transaction should be one independently verifiable frame:

```text
magic | format-version | header-length | payload-length
base-revision | commit-revision | tx-id | timestamp
payload-hash (BLAKE3/SHA-256 or CRC32C for tear detection)
header-hash | canonical transaction payload | frame trailer
```

The payload contains the complete logical transaction (`upserts`, `deletes`), not
unframed JSON lines. Under an exclusive writer lock:

1. verify `base-revision`/idempotency key;
2. append the full frame;
3. sync the log file;
4. only then publish/acknowledge `commit-revision`.

Recovery scans from the last snapshot sequence, accepts only complete frames with valid
lengths, revisions, and hashes, and truncates/quarantines an invalid tail. It must never
skip an invalid interior frame and continue.

#### Checksummed segments and snapshots

- Use immutable log segments named by start/end revision, with a checksum manifest.
- Write a snapshot containing format version, last included revision, node count, and
  whole-snapshot hash.
- Write snapshot to a same-filesystem temporary path, sync, validate by reopening, then
  rename and sync the directory.
- Publish a double-buffered manifest (`MANIFEST.A/B` plus generation/checksum) that
  points to one snapshot and its following segments.
- Rotate/delete old segments only after the new snapshot and manifest are durable and
  at least one older verified recovery generation remains.
- Compaction is logically a read transaction: snapshot at revision R while later writes
  continue in a new segment; publish only after reproducing the state hash at R.

This can be made robust, but it recreates transaction framing, locking, recovery,
checkpointing, integrity checking, backup coordination, and format migration. It is a
reasonable bounded stopgap only if SQLite adoption is intentionally deferred.

## Scale projections

### Measurement method

Measurements were taken on the current Apple Silicon host with Bun 1.3.14. The current
worktree intentionally has no installed `tools/kb` dependencies, so the identical
benchmark/source/lockfile in sibling worktree `kb-r1-editor` was used without modifying
either checkout. Five runs of the checked-in sparse 50k benchmark passed:

| Phase, 50,050 sparse nodes | Median | Observed range |
|---|---:|---:|
| Initial whole-file write | 52 ms | 42–76 ms |
| JSONL load/validation | 184 ms | 123–211 ms |
| DataScript build | 164 ms | 131–324 ms |
| Indexed tag query, 5k rows | 44 ms | 25–58 ms |
| Load + build + query | 405 ms | 285–588 ms |

A second fixture models a less optimistic graph: about 13.1 datoms/node, with five
property fields/six values, refs, a child edge, and periodic mentions. Its measured
anchors were:

| Nodes | JSONL | Datoms | Load | DataScript build | Retained JS heap after build | One-node commit | Full-result query |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10k | 4.4 MiB | 0.13M | 90 ms | 109 ms | 68 MiB | 130 ms | 51 ms / 10k rows |
| 100k | 43.6 MiB | 1.31M | 679 ms | 1.07 s | 498 MiB | 918 ms | 316 ms / 100k rows |
| 250k | 109.1 MiB | 3.28M | 1.83 s | 4.01 s | 1.72 GiB | 2.53 s | 1.35 s / 250k rows |

These are single-run engineering anchors, not release-grade statistics. "One-node
commit" exposes the present O(N) read/backup/rewrite cost. Heap is more useful than RSS
here because Bun retains allocator high-water pages after fixture generation. Browser
memory was not measured in this run and is reported below as a range based on its three
full graph representations.

For a lighter 7–8-datom/node fixture, DataScript build was 59 ms/10k, 534 ms/100k, and
1.56 s/250k. Point queries were 5–10 ms; queries returning 10% of nodes were
21/54/163 ms. Result cardinality and datom density matter more than node count alone.

### Projected envelope

| Scale | Projected current behavior | UI/server consequence | Assessment |
|---:|---|---|---|
| 10k nodes | 2–5 MiB realistic file; ~0.2–0.3 s cold load+build; ~0.13 s one-node file commit | Browser full clone likely ~0.15–0.35 GiB; full rebuilds are noticeable but generally interactive | Comfortable, with correctness risks unchanged |
| 100k nodes | ~44 MiB, 1.31M datoms; ~1.75 s cold load+build; ~0.9 s one-node commit; 5 ms point / 54 ms 10%-result / 316 ms full-result queries | Browser full clone estimated ~0.8–1.5 GiB. A UI mutation can multiply load/build work into several seconds | Operational boundary; current reload model breaks UX |
| 1M nodes | ~436 MiB, ~13.1M datoms; ~7–10 s JSON load, ~16–30 s DataScript build, ~7–10+ GiB server heap, ~10–15 s one-node rewrite; multi-second broad queries | Full HTTP snapshot plus wire array, outline map, and client DataScript plausibly consumes another ~10–20 GiB and blocks the browser for tens of seconds | Architecturally untenable |

The 1M figures are projections anchored at 100k and 250k, not measurements. They are
shown as ranges because DataScript build/heap became superlinear between those anchors
and garbage-collector behavior changes near memory pressure.

### WS fanout cost

For N nodes, D datoms, C clients, and Q subscriptions/client, the current cost of one
changed node is approximately:

```text
O(N log N) content hash + O(N) diff + O(D) DataScript rebuild
+ C × Q × (query evaluation + full-result serialization/hash)
```

The wire transaction itself is small, but its production is not. At 100 clients × 10
identical subscriptions, one mutation can trigger 1,000 duplicate query evaluations.
Long result sets then multiply bytes and per-client parsing. This limit can arrive well
before the storage limit.

### Where full-reload breaks

- **Durability/correctness:** already broken for concurrent writers at any N.
- **Interactive write latency:** around 50k–100k realistic nodes because surface-level
  duplicate rebuilds amplify a one-second primitive.
- **Browser memory/startup:** around 100k–250k depending on node density and device.
- **Server full DataScript:** several hundred thousand dense nodes; one million requires
  multi-gigabyte heap and long restart.
- **Git ergonomics:** tens of MiB and frequent whole-file rewrites produce large diffs,
  merge conflicts, and repository growth even before runtime fails.

## Option matrix

Scores are 1 (poor) to 5 (strong), assuming each option is implemented correctly.

| Option | Crash durability | Concurrent writers | Incremental write/scale | Bun/ops fit | Backup/portability | Migration safety | Maintenance burden |
|---|---:|---:|---:|---:|---:|---:|---:|
| Hardened whole-file JSONL | 3 | 3 with lock/CAS | 1 | 5 | 5 | 5 | 4 |
| JSONL snapshot + framed WAL | 4 | 3 (single writer) | 3 | 5 | 4 | 4 | 2 |
| Custom checksummed segmented log + in-memory indexes | 4 | 3 (single writer) | 4 | 4 | 3 | 3 | 1 |
| SQLite WAL + Datalog layer | 5 | 4 | 5 | 5 | 3 | 4 | 5 |
| LMDB-style embedded KV + DataScript | 5 | 4 | 5 | 2–3 | 4 | 3 | 3 |
| sled-style Rust KV sidecar/FFI | 4 | 3–4 | 5 | 1 | 3 | 2 | 2 |

### Staying with whole-file JSONL

**Strengths:** exact current format, human inspectability, stable Git diffs, easiest
rollback, no engine dependency. With a writer lock, durable replacement, checksums, and
verified generation rotation it can become much safer.

**Limits:** every write and every cold load remains O(N); the whole body is allocated;
Git merge semantics do not provide runtime concurrency; query/UI architecture remains
unchanged. Suitable as stage 0 and as export, not as the long-term primary.

### JSONL snapshot plus framed WAL

**Strengths:** preserves readable periodic snapshots; acknowledged writes append only;
straightforward additive migration; good agent/backup portability. It can defer
compaction and make small writes O(transaction size).

**Limits:** a custom WAL is a storage engine. Correct locks, checksums, segment
manifests, compaction, crash recovery, idempotency, and backup pinning become kb's
permanent responsibility. It still needs all-in-memory query indexes unless the query
path changes.

### Custom segmented log

**Strengths:** complete control of node-native transaction shape, excellent sequential
writes, immutable segments are backup-friendly, and change feeds map naturally to WS.

**Limits:** highest correctness burden and least mature tooling. Space reclamation,
schema upgrades, index rebuilds, corruption repair, concurrent readers, and platform
flush behavior all become product code. There is no owner requirement that justifies
rebuilding these solved database mechanisms.

### SQLite WAL

**Strengths:** ACID transactions, mature crash recovery, checks/integrity tooling,
MVCC-style reader snapshots with one serialized writer, incremental updates, schema
migrations, and no npm/native-addon deployment because Bun includes `bun:sqlite`.
SQLite documents that WAL permits readers and a writer concurrently and that
`synchronous=FULL` makes transactions durable across power loss, subject to filesystem
and hardware guarantees.

**Limits:** binary primary data is not Git-mergeable; WAL checkpointing needs policy;
long readers can starve checkpoints; live-file backup must use SQLite-aware tooling;
SQLite does not execute current DataScript Datalog. Application revisions are still
needed to reject stale semantic updates even though SQLite serializes physical writes.

Recommended initial schema shape: preserve each canonical node JSON exactly in a
`nodes(id PRIMARY KEY, json, row_version)` table, with normalized child/property/ref
projection tables updated in the same transaction. Add `meta(schema_version,
revision, exported_revision)` and a bounded `changes(revision, node_id, op)` feed. This
minimizes migration risk and retains unknown JSON keys while enabling indexed access.

### LMDB/sled-style KV

LMDB offers excellent read performance, ACID transactions, consistent read snapshots,
a single writer/many readers model, and safe backup APIs. `lmdb-js` also exposes version
conditions. The cost here is integration risk: a native addon/prebuilt binary on Bun,
memory-map sizing/operations, less familiar repair tooling, and no advantage over
SQLite for this relational graph shape. Its ordered KV model would require kb to own
secondary index encoding and migrations.

sled is a Rust library rather than a Bun-native embedded option. A sidecar or FFI layer
adds process/protocol and packaging failure modes while still requiring custom graph
indexes. It should not be selected unless kb moves its storage/query core to Rust for
independent reasons.

## Recommendation

### Storage

Adopt SQLite WAL as the eventual authority with these non-negotiable settings and
contracts:

- `PRAGMA journal_mode=WAL` and verify the returned mode;
- `PRAGMA synchronous=FULL` for owner-required acknowledged-write durability;
- on Darwin, evaluate and enable `PRAGMA fullfsync=ON` (and checkpoint full-sync
  behavior) if the power-loss contract requires the strongest device flush SQLite can
  request; measure its latency rather than silently weakening the contract;
- explicit transactions (`BEGIN IMMEDIATE` for writes), a bounded busy timeout, and a
  deliberate WAL checkpoint policy;
- foreign keys/check constraints where they encode hard invariants;
- persistent `revision` and per-node `row_version` values;
- every mutation carries `expectedRevision` or expected node versions and an
  idempotency key; stale writes return `conflict`, never silently win;
- startup `quick_check`/periodic `integrity_check`, schema-version migrations in a
  transaction, and disk-full/read-only failure tests;
- canonical JSONL export labeled with database revision and content hash.

`synchronous=NORMAL` is explicitly not enough for this requirement: SQLite states that
a WAL commit can roll back after power loss in NORMAL mode even though database
consistency is preserved.

### Writer topology

Use one long-lived local kb broker as the normal writer:

```text
CLI ─┐
MCP ─┼─ local broker/UDS ─ ordered action txn ─ SQLite WAL
UI  ─┘                         │
                              ├─ persistent revision/change feed
                              └─ query/subscription service
```

The broker evaluates an action against the same revision it commits. UI and MCP can be
in-process adapters; CLI/agents use a local Unix socket. For offline/recovery use, a
direct writer may acquire the same exclusive broker lease and perform the identical
SQLite transaction contract. It must fail rather than create a second writer regime
while the broker lease is live.

SQLite can serialize writes from multiple processes, but the broker is still valuable:
it provides deterministic action order, idempotency, one subscription/change-feed
owner, extension execution isolation, and clear conflict responses. SQLite remains the
last line of crash/locking defense.

### Query/index placement

1. **Near term (up to low hundreds of thousands):** keep one server DataScript
   connection and transact only changed node datoms. Persist stable integer eids or use
   a stable identity scheme. Never rebuild the graph for a one-node tx.
2. Intern identical subscriptions by normalized query + inputs. Evaluate once and
   fan out one result/delta to all subscribers.
3. Compile a conservative dependency footprint for each query (attributes, node ids,
   hierarchy/mention dependencies). Rerun only on intersecting changes. Queries with
   rules/dynamic attributes fall back to coarse invalidation for correctness.
4. Hash rows by stable keys and send `added/updated/removed` deltas. Cap result sizes and
   paginate broad queries.
5. **Million-node path:** execute the supported Datalog subset against normalized
   SQLite indexes, or explicitly bound DataScript to a hot/working set. Maintain a
   compatibility corpus comparing old DataScript and new backend results. Do not claim
   1M support while full DataScript remains mandatory.

The browser should hold a normalized cache of the visible subtree, active query pages,
and schema nodes only. Initial load becomes workspace roots + a bounded child page;
zoom/query/navigation fetches more. Optimistic writes apply node deltas locally, then
reconcile by revision. A debug/export endpoint may retain full snapshots behind a size
guard, but normal UI boot must not call full `GET /api/graph` at scale.

### Backup and export

- Keep the existing `nodes.jsonl` unchanged through shadow migration.
- After cutover, export canonical JSONL from a specific committed revision. Include a
  sidecar/manifest with schema version, DB revision, node count, and content hash.
- An export failure does not roll back a committed DB transaction; instead expose
  `exported_revision < revision` loudly and block a "backup healthy" check.
- Produce SQLite backups with an online backup operation or `VACUUM INTO` to a temporary
  file, validate (`integrity_check` + revision/hash), then atomically publish an
  immutable backup artifact.
- Mackup/Time Machine should copy the immutable artifact, not a live main database file
  without its WAL. Retain at least two generations and test restore.
- Decide separately whether canonical JSONL remains committed after cutover. It is an
  excellent portable/auditable export but should be generated, not hand-merged into the
  live database.

## Staged roadmap

Every stage below is useful on its own and preserves all existing user/TODO data.

### Stage 0 — harden and instrument the current course

No persistent-format change.

- Add an OS-level exclusive lock covering load → semantic mutation → durable replace.
- Add a persistent revision/hash manifest and reject stale base revisions.
- Replace write/backup/rename with a documented durable protocol: sync candidate,
  validate, rotate verified generations safely, rename, sync parent directory, then
  acknowledge.
- On startup, classify live/backup/temp candidates by schema, revision, count, and hash;
  never auto-promote ambiguity without preserving all candidates.
- Make load actually streaming and enforce file/node/line size limits.
- Add integrity audit, fault injection, and the benchmark matrix below.

Exit criterion: no lost acknowledged transaction in crash/concurrency tests; current
JSONL remains byte-compatible.

### Optional stage 0.5 — framed WAL stopgap

Only take this stage if SQLite work is intentionally delayed. Append synced,
checksummed transaction frames after a verified snapshot and compact by revision as
described above. Do not build both this and a full segmented engine on the default path.

Exit criterion: restart from snapshot + frames reproduces the canonical JSONL hash for
every injected crash point.

### Stage 1 — one writer and revisioned action protocol

- Introduce the local broker/UDS and one mutation queue.
- Add `expectedRevision`, per-node versions where useful, transaction ids, and
  idempotency keys to the action contract additively.
- Route UI and MCP through the broker; let CLI discover it. Preserve a locked offline
  path for recovery.
- Persist a bounded logical change feed for subscribers/exporters.

Exit criterion: old clients remain supported during transition; concurrent same-node
edits return deterministic conflict or success with a linearizable history.

### Stage 2 — incremental server and bounded browser

- Give nodes stable DataScript eids and transact retract/add datoms per changed node.
- Intern subscriptions and add conservative attribute-based invalidation plus row
  deltas.
- Add scoped/paged graph APIs; migrate UI boot, zoom, outline children, query results,
  and resync away from full snapshots.
- Keep a feature-flagged full-snapshot path for comparison and rollback.

Exit criterion: a one-node change is O(changed datoms + affected queries), and browser
memory grows with the active working set rather than total graph size.

### Stage 3 — SQLite shadow store

- Define schema/version/migration and import all canonical JSONL, preserving unknown
  node keys.
- Keep JSONL authoritative. After each locked JSONL commit, update/rebuild SQLite as a
  disposable shadow and compare revision, canonical export hash, node count, and query
  corpus.
- Exercise WAL/FULL, checkpoints, integrity checks, backup snapshots, restore, disk
  full, and abrupt termination.

Exit criterion: repeated import/export is lossless; shadow reads and Datalog
compatibility tests agree across real data and adversarial fixtures. Deleting the
shadow changes no user data.

### Stage 4 — reversible SQLite cutover

- In one explicit migration, record source JSONL hash and imported DB revision.
- Make SQLite authoritative behind the unchanged Store/action interface.
- Generate revisioned canonical JSONL exports; leave the pre-cutover JSONL immutable
  until the retention window expires.
- Ship a verified rollback command that restores a chosen export into either backend.
- Activate immutable DB backups and backup-health auditing before declaring success.

Exit criterion: crash-safe transactional writes, tested backup/restore, no full-file
write amplification, and demonstrated rollback with exact canonical hash.

### Stage 5 — million-node query backend

- Define the supported Datalog contract from the real query corpus.
- Implement a SQLite-backed adapter for that contract, or document and enforce a
  bounded hybrid DataScript working set.
- Run old/new engines in shadow comparison, including result ordering/identity and
  subscription invalidation.
- Retire all-graph DataScript only after compatibility and latency gates pass.

Exit criterion: the 1M dense fixture meets the cold-start, memory, query, mutation, and
fanout budgets without loading the entire graph into the browser.

## Concrete benchmarks and tests to add

### Fixture matrix

Test 10k, 50k, 100k, 250k, and 1M nodes in at least three shapes:

- sparse: current checked-in fixture;
- realistic: 5 fields, 6 values, 1 tag, 1 ref, hierarchy edge, 10% mention rate
  (~13 datoms/node);
- dense/adversarial: 20 fields, multi-values, long text, high fanout children/refs,
  large query results.

Record fixture bytes and exact datom counts so "node" is never the only scale unit.

### Storage measurements

- cold parse/validate, import, open, recovery, and integrity-check time;
- retained and peak heap/RSS in isolated processes after forced GC;
- single-node and 1/10/100-node transaction p50/p95/p99;
- bytes written/fsynced per logical byte, WAL growth, checkpoint duration/stalls;
- disk-full at temp/log/DB/checkpoint/backup stages;
- canonical export and backup/restore throughput.

Suggested gates: local one-node commit p99 <100 ms at 1M; server ready for point reads
<2 s; no write should scale with total JSON/export size on the synchronous path.

### Crash and recovery

- Deterministically kill after every write, sync, rename, manifest, WAL frame, SQLite
  commit, and checkpoint boundary.
- Run thousands of randomized kill/restart cycles and VM/power-cut tests.
- Assert: recovery yields the last acknowledged revision or a later complete revision,
  never an earlier acknowledged state and never a partially applied transaction.
- Corrupt/truncate/bit-flip live, backup, segment, WAL, and manifest independently;
  verify fail-closed diagnostics and non-destructive recovery.

### Concurrency/linearizability

- 2/8/32 concurrent CLI, MCP, and UI writers on distinct and identical nodes;
- competing moves/parent ordering, set/unset, delete/update, and idempotent retry;
- long readers during write/checkpoint and broker crash/restart;
- record histories and verify a legal serial order, explicit conflicts, and no lost
  acknowledged write.

### Query and subscription

- point lookup, indexed tag/property, multi-join traversal, backlinks, hierarchy,
  aggregation, rules, broad text search, and result sizes 1/100/10k/100k;
- affected vs unrelated changes for every query class;
- 1/10/100 clients × 1/10 subscriptions, with identical and unique queries;
- CPU, p99 mutation-to-notification latency, evaluations performed, rows/bytes sent,
  reconnect replay, and slow-client backpressure.

Suggested gates: point/indexed p95 <20 ms at 1M; affected 10k-row query p95 <100 ms;
unaffected subscriptions perform zero query evaluations; identical subscriptions are
evaluated once per revision.

### UI

- cold first-interactive time and transferred bytes at 10k/100k/1M;
- retained browser heap after boot, zoom, broad query, and 1,000 edits;
- edit-to-paint and remote-delta-to-paint p95;
- rev gap/restart recovery without a full graph fetch;
- browser automation on a constrained-memory profile.

Suggested gates: first interactive <500 ms on a warm local server, ordinary edit paint
<50 ms, and boot memory bounded independently of total node count.

### Migration and backup

- real `.kb/nodes.jsonl` plus duplicates, unknown keys, Unicode, large text, dangling
  refs, invalid lines, cycles, and legacy system ids;
- JSONL → shadow DB → canonical export byte/hash comparison;
- crash and retry every migration step;
- online backup while writes continue, then restore into an empty root and compare
  revision/content hash/query corpus;
- downgrade/rollback from every stage.

## Open questions for the owner

1. After SQLite cutover, should canonical JSONL remain committed after every revision,
   on explicit checkpoints, or only as release/backup exports? Per-transaction export
   preserves Git auditability but reintroduces asynchronous repository churn.
2. Is "acknowledged" required to survive sudden power loss? This report assumes yes and
   therefore recommends SQLite WAL `synchronous=FULL`, not NORMAL.
3. Should conflicting edits be strict optimistic conflicts, field-level merge, or
   explicit last-writer-wins for selected operations? Silent whole-node overwrite should
   not remain the default.
4. Is arbitrary DataScript Datalog syntax a permanent compatibility contract, or may kb
   define a supported subset that can be compiled to SQLite? This decides the credible
   1M-node query architecture.
5. What is the expected upper bound for one machine: 100k, 1M, or >1M nodes, and how
   dense are fields/refs in real usage? Datom count and result size should set budgets.
6. May the normal CLI require a local broker, with locked direct mode reserved for
   recovery, or must every invocation remain a standalone direct writer?
7. Which system owns authoritative DB backups? Current policy Mackup-backs only
   `.kb/assets`; a SQLite primary needs an explicit immutable-snapshot destination,
   retention, encryption, and restore drill.
8. Is multi-device concurrent editing in scope, or only multiple local processes? SQLite
   WAL is same-host; network/multi-device replication is a separate architecture.
9. How much query-result staleness is acceptable during background index rebuild or
   checkpoint? Writes should remain durable even when secondary indexes are rebuilding.
10. Should kb retain a transaction history/audit log beyond bounded change-feed and
    backup retention, or is point-in-time recovery out of scope?

## Primary references

- SQLite WAL: <https://sqlite.org/wal.html>
- SQLite synchronous durability: <https://sqlite.org/pragma.html#pragma_synchronous>
- SQLite atomic commit: <https://sqlite.org/atomiccommit.html>
- SQLite online backup: <https://sqlite.org/backup.html>
- SQLite corruption/unsafe live copying: <https://sqlite.org/howtocorrupt.html>
- Bun built-in SQLite/WAL/transactions: <https://bun.sh/docs/runtime/sqlite>
- lmdb-js transactions, backup, version conditions, and sync behavior:
  <https://github.com/kriszyp/lmdb-js>
