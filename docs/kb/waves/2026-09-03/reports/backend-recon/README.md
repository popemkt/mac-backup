# r4-backend-recon — a measured index/backend for kb at 100 k and 1 M datoms

Recon report — 2026-09-04. Brief: [`briefs/r4-backend-recon.md`](../../briefs/r4-backend-recon.md).
Branch `feature/r4-backend-recon` off `kb-wave/2026-09-03`, head `2163540` at
the start of the run. Nothing under `tools/kb/packages/**` was touched; every
line of code in this report lives in [`bench/`](./bench) with its own
`package.json` and lockfile.

Machine: Apple Silicon (`aarch64-darwin`), macOS 26.6.2, Bun 1.3.14,
Node 26.7.0. Every number below was produced on this machine in one serial
pass — see [§10 Reproducing](#10-reproducing).

---

## 0. TL;DR

**The p1 revisit trigger is aimed at the wrong metric, and it fires an order of
magnitude too late.**

p1 §0 says revisit "when the hosted everything-KB approaches ~1 M datoms
(≈400 MB in-process at the measured 380 B/datom)" — a *memory* trigger. Memory
turns out to be the axis that does not discriminate at all:

| at 1 M datoms (117 866 nodes) | DataScript 1.8.1 | `bun:sqlite` EAV | ratio |
|---|---|---|---|
| **transitive closure of `:node/mentions`** (2 059 rows) | **1 570 ms** | **5.4 ms** | **294×** |
| Q1 "all todos" (52 162 rows) | 260 ms | 18 ms | 14× |
| Q4 tag inheritance, transitive (65 391 rows) | 386 ms | 49 ms | 8× |
| one-node update | 0.22 ms | 0.008 ms | 27× |
| cold start with a built index available | 1 619 ms (always rebuilds) | **10.8 ms** (reopen) | **150×** |
| build the index from JSONL | 1 619 ms | 3 753 ms | 0.4× |
| resident memory | 824 MB RSS / 320 MB JS heap | 790 MB RSS / 348 MB JS heap | **~1×** |

Memory is a wash — 320 MB against 348 MB of JS heap. What breaks is **query
latency**, and the p1 Phase-3 snapshot cache, which is the thing p1 schedules to
fix cold start, does nothing for it: measured in the same process, restoring the
snapshot takes **727 ms against a 1 501 ms rebuild at 1 M — 2.1×, not the 7×
p1 recorded at 50 k** — and every query afterwards is exactly as slow, closure
included.

**Closure is already unusable one order of magnitude below the trigger.** At
100 k datoms — 11 889 nodes, roughly 40× today's graph and well inside "one
person's KB" — DataScript's recursive-rule fixpoint takes **791 ms** to return
2 059 reachable nodes. SQLite's `WITH RECURSIVE` returns the same 2 059 rows in
**3.5 ms**, Oxigraph's SPARQL property path in **4.5 ms**, a hand-written BFS
over plain `Map`s in **0.15 ms**. DataScript is the outlier by two to three
orders of magnitude, and it is the only candidate whose closure cost **grows
with the size of the whole graph rather than the size of the answer** (791 ms →
1 570 ms for the same 2 059-row answer; SQLite goes 3.5 ms → 5.4 ms).

**Recommendation: keep DataScript as the datalog surface, land p1 Phase 2 (the
`KbIndex` port + the query IR) as written, delete p1 Phase 3 (the snapshot
cache) from the plan, and spend that budget on a `SqliteIndex` implementation of
the same port.** The snapshot optimises the one metric a hosted tailnet process
never pays, and only by 2.1×; `bun:sqlite` improves all four axes at once, needs
no new runtime dependency, is durable with **zero** index construction on
reopen, and the *same SQL* runs unchanged in the browser (measured: `sql.js` in
memory, `wa-sqlite` on OPFS).

Two p1 rejections are re-opened with new facts, both dated: **DuckDB** (the Bun
crash issue is closed and it now runs) and **Kuzu/LadybugDB** (the fork is at
0.20.2, MIT, with a prebuilt darwin-arm64 addon that loads under Bun). Both were
benchmarked. Neither displaces `bun:sqlite`, and §5.6 / §5.7 say why.

**TerminusDB** was checked at the owner's request and not benchmarked, because
it has no in-process mode: SWI-Prolog core, daemon only, HTTP client only
(§5.8). It is well maintained — DFRNT, v12.0.7 on 2026-08-10, Apache-2.0 — so
it belongs in p1 §0's *daemon* bucket, not the dead one. The deeper reason to
decline it is that the git-like history it sells is the history kb already gets
from git over line-per-node JSONL: as a derived cache that history would be one
commit deep, and as truth it would be a second commit graph with no mechanical
bridge to git's.

---

## 1. Findings table

One row per candidate; all figures at 1 M datoms unless marked. "Verdict" is
what this report recommends doing, not a score.

| candidate | model fits kb? | build index | reopen a built index | `#todo` scan | closure | memory (RSS) | 1-node write | durable | browser | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **DataScript 1.8.1** (incumbent) | native — EAV *is* the model | 1 619 ms | — (always rebuilds) | 260 ms | **1 570 ms** | 824 MB | 0.22 ms | no | yes (already) | **keep** as the datalog surface and `runDatalog` |
| DataScript + `d.serializable` snapshot | same | 1 501 ms | 727 ms (46 MB of JSON) | 293 ms | 3 512 ms | 1 081 MB | 0.19 ms | cache only | 46 MB parse per page load | **drop** — p1 Phase 3; 2.1× on cold start, 0× on everything else |
| **`bun:sqlite` EAV, file-backed** | native — 1:1 with the datom set | 3 753 ms | **10.8 ms** | **18 ms** | **6.6 ms** | 790 MB | **0.025 ms** | **yes** | **yes, same SQL** | **adopt** — second `KbIndex` implementation |
| `bun:sqlite` EAV, in-memory | same | 3 417 ms | — | 39 ms | 5.4 ms | 1 075 MB | 0.008 ms | no | — | same engine, no-cache mode |
| hand-rolled typed `Map` indexes | native, no datom expansion | **327 ms** | — | **0 ms** | **0.15 ms** | **463 MB** | **0.002 ms** | no | yes | **partially** — keep as the fast paths *inside* the index, never as the surface |
| Oxigraph 0.5.11 (wasm) | native — triples are datoms | 1 480 ms | 1 212 ms (reload 91 MB N-Quads) | 84 ms | **5.0 ms** | **1 551 MB** | 0.36 ms | **no** (JS build) | yes, 4.05 MB wasm | **fallback** if path queries land *and* memory allows |
| DuckDB 1.5.5 | poor — no `ANY`, no partial index | **1 511 ms** | not measured | 24 ms | 13 ms | 1 147 MB | 0.30 ms | yes | no story here | **reject on fit** (Bun blocker gone — §5.6) |
| LadybugDB 0.20.2 (Cypher) | poor — fixed schema forces full reification | 2 527 ms | 21.5 ms | 481 ms | 23 ms | 1 288 MB | **10.0 ms** | yes | wasm build exists | **reject for now; the destination for path queries** |
| `sql.js` 1.14.2 (browser) | same as `bun:sqlite` | 4 406 ms | — | 25 ms | 9.8 ms | 1 020 MB JS heap | — | no | — | browser: **memory-only tier** |
| `wa-sqlite` 1.0.0 + OPFS (browser) | same as `bun:sqlite` | **30 357 ms** | **700 ms** (all 1 000 004 rows) | 146 ms | 107 ms | in wasm + OPFS | — | **yes** | — | browser: **the only durable option** |
| TerminusDB 12.0.7 | n/a — daemon only, no in-process mode | **not benchmarked** | — | — | — | — | — | server-side | **no** (HTTP client only) | **reject** — daemon bucket; its git-for-data is what kb already gets from git (§5.8) |

Read the two columns that discriminate: **closure** and **reopen**. Everything
else sits within an order of magnitude across the field; those two do not.

TerminusDB's row is empty on purpose: the addendum's own precondition is "no
benchmark unless an in-process mode exists", and there is none (§5.8). It is
listed so the next reader does not have to re-derive that.

---

## 2. Method

### 2.1 The dataset

[`bench/gen.ts`](./bench/gen.ts) generates one JSONL file per scale in kb's own
node shape. Every candidate loads the same file; the generator is seeded, so
two runs produce byte-identical fixtures.

- **The real graph is embedded verbatim.** All 316 lines of `.kb/nodes.jsonl`
  are the first thing in the file, so every `sys.*` field and tag node the
  ontology, render and resolve paths depend on is present with its real id, and
  the queries below hit the real attribute names (`:f/sys.f.type`,
  `:f/01KZFW1A581GP25YPYRF614BAZ` for `status`).
- **Shape is calibrated against that graph**: text lengths (p50 43, p90 134,
  max 366), children fan-out (280 of 316 nodes are leaves, thin tail to 36),
  and both reference carriers — `{t:"ref"}` prop values and `[[id]]` tokens in
  text.
- **Fixed fixtures, identical at both scales**, so a latency row means the same
  thing at 100 k and 1 M: a backlink hub with an in-degree of exactly 500 (half
  the sources via text, half via a ref prop), a `:node/mentions` binary tree of
  depth 11 (2 047 nodes) for closure, a parent with 36 ordered children, and a
  three-level tag `extends` chain for the inheritance question.

| | real `.kb/nodes.jsonl` | synthetic 100 k | synthetic 1 M |
|---|---|---|---|
| nodes | 316 | 11 889 | 117 866 |
| datoms (`nodesToDatoms`) | **2 591** | 100 007 | 1 000 004 |
| datoms/node | **8.20** | 8.41 | 8.48 |
| bytes on disk | 136 800 | 4 551 224 | 44 875 331 |

**Correction to `reports/measurements.md` §7.** That table records 7.2
datoms/node on the real graph. Running the actual builder gives **8.20**. The
7.2 figure omits the `:node/mentions` datoms that ref-typed *props* produce —
it counted only `[[…]]` tokens in text, of which the real graph has exactly
one, while it has 317 ref prop values. The synthetic 8.41/8.48 is therefore on
target, not above it, and 1 M datoms is **117 866 nodes**, inside p1's
projected 120–140 k.

### 2.2 The datom builder is shared, not re-implemented

[`bench/lib/kb-datoms.ts`](./bench/lib/kb-datoms.ts) is a verbatim copy of
`tools/kb/packages/query/src/datascript.ts`
(sha256 `8d09e24e…`, commit `2163540`), with only the `@kb/model` import
replaced by local types. Copied rather than imported because this directory may
not add a dependency on a `tools/kb` package and `tools/kb` has no
`node_modules` in this worktree. Consequence: **every candidate indexes exactly
the same datoms**, so a latency difference is a difference in the index, not in
what was indexed.

### 2.3 The eight questions

Q1–Q6 are the six from
[`reports/datalog-vs-cypher/README.md`](../datalog-vs-cypher/README.md) §3, same
numbering. BL is backlinks (the same question as Q3, measured twice to expose
cache effects). CL is the transitive closure of `:node/mentions`. PULL is the
subtree projection. Each candidate answers all eight, and **the row counts are
compared across candidates** — a candidate that returns a different count has
not implemented the question, however fast it looks. §4's row-count table is
that gate, and it is uniform: 4 533 / 733 / 500 / 7 043 / 36 / 8 / 2 059 / 36
at 100 k and 52 162 / 8 725 / 500 / 65 391 / 36 / 8 / 2 059 / 36 at 1 M for
every candidate that answered.

Two questions carry a modelling note that is itself a finding:

- **Q5 (children in order).** `:node/child-order` is a per-parent *set* in EAV,
  not an edge property, so joining it to `:node/child` yields the cartesian
  product — 36 children × 36 orders = 1 296 rows, reproduced here. The ordered
  answer lives in the parent's `:node/children` vector, which is what the code
  actually reads. So Q5 asks the child-set question in datalog and gets order
  as a projection; SQLite reads the vector with `json_each`; RDF needs an
  out-of-band ordered literal; only the LPG candidate has a native edge
  property and answers it directly. This is exactly the "Child Ordering
  Dilemma" filed as open question 2 in the datalog-vs-cypher handoff.
- **Rules must be normalized like queries.** `kb`'s `query()` runs
  `normalizeEdnQuery` on the query string but nothing normalizes a
  caller-supplied `%` rules vector. An un-normalized `:f/…` inside a rule stays
  a keyword while the datoms hold strings, and DataScript dies mid-fixpoint
  with `Cannot compare :node/created-at to :f/sys.f.onto.extends`. Reproduced
  here on the first attempt at Q4. This is a live defect in the `graph.run`
  surface, not a benchmark artefact — see §8.

### 2.4 Metrics

Per candidate, per scale: cold load from JSONL broken into stages; resident
memory delta; p50 over 20 runs for each of the eight questions plus search;
one-node update; and, where the candidate persists, the cost to restore.

- **`runs` is reported per row.** A query whose cumulative time passes 8 s
  stops early (minimum 3 samples), so DataScript's closure row at 1 M is
  honestly a 3-run p50 rather than a silently-truncated 20-run one.
- **Memory: read RSS, not JS heap.** `oxigraph`, `sql.js` and `wa-sqlite` keep
  their store in wasm linear memory, which `heapUsed` cannot see. RSS is
  reported as the primary figure for that reason. Two caveats stated rather
  than hidden: RSS does not shrink when the allocator frees, so it is an upper
  bound on the live set; and `heapUsed` after `Bun.gc(true)` is noisy at 1 M
  (typed-maps reports 86 MB where its 100 k reading extrapolates to ~320 MB).
  Treat memory as "same order of magnitude" evidence, which is all the
  recommendation needs it for.
- **One pass, uncontended, or the numbers are worthless.** An early draft ran
  two candidates concurrently and reported `sqlite-mem`'s 100 k cold load as
  1 480 ms against 336 ms for the same code on a quiet machine — a 4.4× error
  in the direction that would have changed the conclusion. `run-all.sh` now
  takes a `flock` so a second pass cannot start, and every figure in this
  report comes from a single serial invocation of it. Absolute numbers still
  move ±30 % run to run on a laptop; **every cross-candidate ratio in §0 and §1
  held across all three passes**, which is what the recommendation rests on.
- **Browser numbers come from headless Chromium** driven by `playwright-core`
  1.62.1 against the cached `chromium_headless_shell-1228` already on the
  machine (playwright wanted revision 1234; two revisions of CDP skew is
  acceptable for a benchmark and the exact build is recorded in each result's
  `versions.chromium`). The page is served cross-origin-isolated
  (`COOP: same-origin`, `COEP: require-corp`), which OPFS sync access handles
  require; `crossOriginIsolated` is asserted `true` in the results.

---

## 3. Measurements

<!-- BEGIN GENERATED TABLES: bun bench/report-tables.ts -->

### 3.1 Cold load, memory, incremental update

| candidate | scale | nodes | datoms | cold load (ms) | RSS Δ (MB) | JS heap Δ (MB) | 1-node update (ms) | persisted restore (ms) |
|---|---|---|---|---|---|---|---|---|
| datascript | 100k | 11,889 | 100,007 | **1,045.8** | 138.5 | 29 | 0.071 | — |
| datascript | 1m | 117,866 | 1,000,004 | **1,618.6** | 823.9 | 319.9 | 0.218 | — |
| datascript-snapshot | 100k | 11,889 | 100,007 | **136** | 141 | 28.4 | 0.118 | 30.5 |
| datascript-snapshot | 1m | 117,866 | 1,000,004 | **1,501.2** | 1,081 | 310.8 | 0.188 | 727.4 |
| sqlite-mem | 100k | 11,889 | 100,007 | **431.7** | 134.7 | 29.2 | 0.009 | — |
| sqlite-mem | 1m | 117,866 | 1,000,004 | **3,416.5** | 1,075 | 331.1 | 0.008 | — |
| sqlite-file | 100k | 11,889 | 100,007 | **422.9** | 111.7 | 27.4 | 0.04 | 3 |
| sqlite-file | 1m | 117,866 | 1,000,004 | **3,753.1** | 789.8 | 347.9 | 0.025 | 10.8 |
| duckdb | 100k | 11,889 | 100,007 | **194.2** | 160.8 | 30.6 | 0.596 | — |
| duckdb | 1m | 117,866 | 1,000,004 | **1,510.8** | 1,147.2 | 282.2 | 0.299 | — |
| oxigraph | 100k | 11,889 | 96,080 | **195.7** | 243.5 | 146.3 | 0.258 | — |
| oxigraph | 1m | 117,866 | 953,848 | **1,480.3** | 1,551.4 | 319.6 | 0.356 | — |
| ladybugdb | 100k | 11,889 | 100,007 | **473.6** | 219.8 | 34 | 9.057 | 24.7 |
| ladybugdb | 1m | 117,866 | 1,000,004 | **2,526.5** | 1,287.9 | 286 | 9.986 | 21.5 |
| typed-maps | 100k | 11,889 | 100,007 | **31.1** | 60.6 | 31.9 | 0.001 | — |
| typed-maps | 1m | 117,866 | 1,000,004 | **327.3** | 462.6 | 86.5 | 0.002 | — |
| sql.js | 100k | 11,889 | 100,007 | **530** | — | 124.9 | — | — |
| sql.js | 1m | 117,866 | 1,000,004 | **4,405.8** | — | 1,020.4 | — | — |
| wa-sqlite-opfs | 100k | 11,889 | 100,007 | **2,701.5** | — | — | — | 72 |
| wa-sqlite-opfs | 1m | 117,866 | 1,000,004 | **30,357.1** | — | — | — | 700.3 |

### 3.2 Query latency, p50 ms

| candidate | scale | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | CL | PULL | search |
|---|---|---|---|---|---|---|---|---|---|---|
| datascript | 100k | 44.318 | 25.297 | 7.728 | 82.557 | 3.753 | 53.408 | 790.516 | 0.375 | — |
| datascript | 1m | 260.234 | 162.799 | 13.331 | 385.733 | 15.798 | 199.177 | 1570.459 | 0.186 | — |
| datascript-snapshot | 100k | 13.013 | 12.975 | 1.873 | 48.538 | 4.66 | 39.679 | 924.387 | 0.25 | — |
| datascript-snapshot | 1m | 293.039 | 130.672 | 12.41 | 471.139 | 20.987 | 262.93 | 3512.019 | 0.307 | — |
| sqlite-mem | 100k | 3.002 | 1.836 | 0.214 | 4.413 | 0.016 | 0.919 | 3.505 | 0.027 | 1.467 |
| sqlite-mem | 1m | 38.505 | 29.281 | 0.211 | 41.349 | 0.039 | 3.723 | 5.35 | 0.027 | 12.842 |
| sqlite-file | 100k | 1.888 | 2.037 | 0.239 | 4.101 | 0.021 | 0.421 | 2.755 | 0.029 | 2.646 |
| sqlite-file | 1m | 18.32 | 20.072 | 0.177 | 48.59 | 0.022 | 4.013 | 6.641 | 0.072 | 30.944 |
| duckdb | 100k | 8.197 | 7.987 | 4.786 | 8.636 | 2.555 | 1.711 | 8.078 | 2.258 | — |
| duckdb | 1m | 23.554 | 12.258 | 4.702 | 29.862 | 2.328 | 2.122 | 13.152 | 3.026 | — |
| oxigraph | 100k | 8.039 | 3.953 | 0.599 | 16.031 | 0.065 | 3.256 | 4.524 | 0.091 | — |
| oxigraph | 1m | 84.21 | 54.038 | 0.561 | 153.018 | 0.067 | 37.017 | 5.038 | 0.101 | — |
| ladybugdb | 100k | 53.283 | 10.256 | 4.43 | 130.336 | 1.36 | 1.243 | 43.146 | 1.145 | — |
| ladybugdb | 1m | 480.57 | 96.726 | 4.809 | 611.653 | 1.393 | 6.07 | 23.219 | 1.123 | — |
| typed-maps | 100k | 0 | 0.043 | 0 | 0.072 | 0 | 0.001 | 0.146 | 0.006 | 0.036 |
| typed-maps | 1m | 0 | 0.233 | 0 | 0.202 | 0 | 0.001 | 0.151 | 0.003 | 0.036 |
| sql.js | 100k | 2.07 | 1.955 | 0.35 | 4.295 | 0.055 | 0.935 | 4.32 | 0.08 | — |
| sql.js | 1m | 25.335 | 22.34 | 0.265 | 61.57 | 0.055 | 8.91 | 9.8 | 0.08 | — |
| wa-sqlite-opfs | 100k | 2.91 | 2.185 | 0.425 | 5.155 | 0.18 | 0.905 | 4.71 | 0.205 | — |
| wa-sqlite-opfs | 1m | 146.305 | 181.76 | 0.48 | 454.345 | 0.195 | 90.025 | 107.015 | 0.27 | — |

### 3.3 Cold-load breakdown, per stage (ms)

- `datascript` @ 100k: {"read":8.2,"jsonParse":190,"nodesToDatoms":172.9,"initDb":657.9,"nodeMap":16.8,"total":1045.8}
- `datascript` @ 1m: {"read":28.3,"jsonParse":111.3,"nodesToDatoms":208.4,"initDb":1243,"nodeMap":27.6,"total":1618.6}
- `datascript-snapshot` @ 100k: {"read":2.6,"jsonParse":7.1,"nodesToDatoms":14.4,"initDb":110.4,"nodeMap":1.5,"total":136}
- `datascript-snapshot` @ 1m: {"read":24,"jsonParse":103.1,"nodesToDatoms":189.4,"initDb":1165.6,"nodeMap":19.1,"total":1501.2}
- `sqlite-mem` @ 100k: {"read":6.2,"jsonParse":7.6,"nodesToDatoms":16.5,"ddl":0.2,"insertDatoms":69.7,"createIndexes":179,"buildFts5":152.5,"total":431.7}
- `sqlite-mem` @ 1m: {"read":21.7,"jsonParse":67.3,"nodesToDatoms":135.6,"ddl":0.3,"insertDatoms":730.5,"createIndexes":2139.8,"buildFts5":321.3,"total":3416.5}
- `sqlite-file` @ 100k: {"read":1.8,"jsonParse":8.1,"nodesToDatoms":19.2,"ddl":4.1,"insertDatoms":110.2,"createIndexes":207.8,"buildFts5":71.7,"total":422.9}
- `sqlite-file` @ 1m: {"read":16.1,"jsonParse":79.1,"nodesToDatoms":152,"ddl":6.3,"insertDatoms":971.8,"createIndexes":2257.3,"buildFts5":270.5,"total":3753.1}
- `duckdb` @ 100k: {"read":1.8,"jsonParse":11,"nodesToDatoms":27.3,"ddl":2.5,"appendDatoms":97.1,"createIndexes":54.5,"total":194.2}
- `duckdb` @ 1m: {"read":15.3,"jsonParse":74.1,"nodesToDatoms":142.9,"ddl":2.2,"appendDatoms":855.6,"createIndexes":420.7,"total":1510.8}
- `oxigraph` @ 100k: {"read":4.2,"jsonParse":15.4,"serialiseNTriples":35,"storeLoad":141.1,"total":195.7}
- `oxigraph` @ 1m: {"read":13,"jsonParse":71.2,"serialiseNTriples":276.7,"storeLoad":1119.4,"total":1480.3}
- `ladybugdb` @ 100k: {"read":1.7,"jsonParse":7.6,"prepareCsv":32.7,"ddl":98.1,"copyFrom":333.5,"total":473.6}
- `ladybugdb` @ 1m: {"read":13.1,"jsonParse":70.5,"prepareCsv":340.7,"ddl":66.2,"copyFrom":2036,"total":2526.5}
- `typed-maps` @ 100k: {"read":1.7,"jsonParse":8.4,"buildMaps":17.8,"buildForwardAdjacency":3.2,"total":31.1}
- `typed-maps` @ 1m: {"read":22.2,"jsonParse":74.8,"buildMaps":181,"buildForwardAdjacency":49.3,"total":327.3}
- `sql.js` @ 100k: {"wasmInit":22.6,"fetchJsonl":16.6,"jsonParse":12.6,"nodesToDatoms":20,"insertDatoms":232.8,"createIndexes":225.4,"buildFts5":"unavailable: no such module: fts5","total":530}
- `sql.js` @ 1m: {"wasmInit":17.1,"fetchJsonl":68.2,"jsonParse":100.7,"nodesToDatoms":104.8,"insertDatoms":1808.6,"createIndexes":2306.4,"buildFts5":"unavailable: no such module: fts5","total":4405.8}
- `wa-sqlite-opfs` @ 100k: {"wasmInit":9.2,"vfsCreate":13.6,"openDb":1.8,"fetchJsonl":13.2,"jsonParse":12,"nodesToDatoms":19,"insertDatoms":721.7,"createIndexes":1911,"buildFts5":"unavailable: no such module: fts5","total":2701.5}
- `wa-sqlite-opfs` @ 1m: {"wasmInit":8.2,"vfsCreate":13.9,"openDb":1.9,"fetchJsonl":67.5,"jsonParse":103.4,"nodesToDatoms":130.2,"insertDatoms":5111.9,"createIndexes":24920.1,"buildFts5":"unavailable: no such module: fts5","total":30357.1}

---

## 4. Row counts — the correctness gate

Every candidate answers the same eight questions over the same fixture, so a
row that differs is a candidate that did not implement the question rather than
one that was faster at it.

| candidate | scale | Q1 | Q2 | Q3 | Q4 | Q5 | Q6 | CL | PULL |
|---|---|---|---|---|---|---|---|---|---|
| datascript | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| datascript | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| datascript-snapshot | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| datascript-snapshot | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| sqlite-mem | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| sqlite-mem | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| sqlite-file | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| sqlite-file | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| duckdb | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| duckdb | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| oxigraph | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| oxigraph | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| ladybugdb | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| ladybugdb | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| typed-maps | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| typed-maps | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| sql.js | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| sql.js | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |
| wa-sqlite-opfs | 100k | 4533 | 733 | 500 | 7043 | 36 | 8 | 2059 | 36 |
| wa-sqlite-opfs | 1m | 52162 | 8725 | 500 | 65391 | 36 | 8 | 2059 | 36 |

<!-- END GENERATED TABLES -->

---

## 5. Candidate by candidate

### 5.1 DataScript as-is — the baseline, and where it stops

Cold load at 1 M is **1 619 ms**, of which `d.init_db` is **1 243 ms (77 %)**
and `nodesToDatoms` 208 ms; reading the 42.8 MB file is 28 ms and `JSON.parse`
111 ms. So **88 % of cold start is index construction**, matching
`reports/recon-persistence.md` §1.3's finding at 50 k and scaling roughly
linearly.

Query latency is the finding. At 1 M, a `#todo` scan is **260 ms** and the
tag-inheritance rule **386 ms**; both return tens of thousands of rows, and
DataScript's cost tracks the size of the *scanned relation*, not the answer.
`kb ui`'s subscription hub re-runs every live query on every change and hashes
the rows (`DESIGN-UI.md`; p1 §4 names per-query dependency tracking as
deferred). Three live `#todo`-shaped queries on a 1 M-datom graph is roughly a
second of work per committed edit.

Closure is worse in kind, not just in degree. The recursive `reach` rule takes
**791 ms at 100 k** and **1 570 ms at 1 M** to return the *same 2 059 rows* from
the *same fixed subtree*. The answer does not grow; the cost does, because
semi-naive fixpoint evaluation re-derives over the whole `:node/mentions`
relation each round. SQLite answers the identical question in 3.5 ms and 5.4 ms
— near-flat, because a recursive CTE walks only what it reaches.

`db_with` is genuinely good: a retract+add pair on an existing string attr is
**0.22 ms at 1 M**, so p1 Phase 2b's incremental path is sound and worth having
whatever the engine. The caveat p1 already records stands — a first-seen ref
attribute forces a full rebuild, because the schema is derived from the data.

*(The `datascript @ 100k` row's 1 046 ms cold load is inflated: it is the first
Bun process the pass launches and pays JIT warmup — its `JSON.parse` alone
reads 190 ms for 4.3 MB, where the 1 M run parses 42.8 MB in 111 ms. Its
query rows, taken after warmup, are sound, and the
`datascript-snapshot @ 100k` row rebuilding the identical db in 136 ms is the
honest 100 k build figure.)*

### 5.2 DataScript + `d.serializable` snapshot (p1 Phase 3)

Confirmed working and confirmed correct: the restored db answers Q1 with
identical row counts, asserted inside the runner and recorded in the result's
notes.

| | 100 k | 1 M |
|---|---|---|
| `d.serializable` | 19.8 ms | 121 ms |
| `JSON.stringify` | 6.2 ms | 130 ms |
| snapshot bytes | 4 479 647 | 46 398 023 |
| read + `JSON.parse` + `from_serializable` | **30.5 ms** | **727 ms** |
| full rebuild **in the same process** | 136 ms | 1 501 ms |
| speed-up | 4.5× | **2.1×** |

p1 records 7× at 50 k. At 1 M it is **2.1×**, because `JSON.parse` (326 ms) and
`from_serializable` (318 ms) both scale with the snapshot while `init_db` has
better constants than the earlier measurement suggested. And it buys cold start
**and nothing else**: Q1 is 293 ms against the fresh build's 260 ms and closure
3 512 ms against 1 570 ms — i.e. unchanged within this benchmark's run-to-run
noise. p1 §3 Phase 3 already says the phase is only worth doing "if CLI cold
start still matters"; for the hosted everything-KB in the brief's first
sentence it does not, because the process is long-lived. This is the phase to
drop.

### 5.3 `bun:sqlite` EAV — the recommendation

One `datoms(e, a, v, ref)` table, four covering indexes — EAVT as the unique
primary, AEVT, AVET, and a **partial** VAET `WHERE ref = 1` — plus a
`node(id, e, doc)` table for point reads and the eid map, plus FTS5 over
`:node/text`.

- **Every question is one statement.** Q4 and CL are `WITH RECURSIVE`, and both
  are *set* recursion (`UNION` de-duplicates), so closure costs **5.4 ms at
  1 M** against DataScript's 1 570 ms.
- **Backlinks and point reads are free.** Q3 **0.18 ms**, Q5 0.02 ms, PULL
  0.07 ms at 1 M. The partial VAET index is why: only ref-typed rows can be
  walked backwards, and that is kb's hottest read path. p1 §4's trigger
  "`node.get` needs to avoid materialising every node" is answered by the same
  table.
- **FTS5 works, with the caveat p1 already gates on.** Real BM25 ranking
  (`ORDER BY rank`) at 12.8 ms/1 M against `graph.search`'s substring scan. The
  open macOS `Database.close()` segfault (oven-sh/bun#37044) is avoided the only
  way it can be: never close the handle. That is an operational constraint, not
  a fix, and it belongs in the gap p1 §4 already files.
- **Reopening a built file does zero index construction: 10.8 ms at 1 M**
  against a 293 MB file — 67× faster than restoring the DataScript snapshot and
  139× faster than rebuilding. This is the structural difference: a snapshot
  must be read, JSON-parsed and re-inflated in full, all of it resident; a
  SQLite file is opened and paged in on demand.
- **Build cost is the price**: 3 753 ms at 1 M file-backed, of which index
  creation is 2 257 ms. You pay it once per fingerprint change — exactly like
  the snapshot — and then never on open.
- **Writes are effectively free**: 0.025 ms for a single-prop update at 1 M.
- **The same SQL runs unchanged in the browser.** `bench/lib/sql.ts` is imported
  by the Bun runner *and* both browser runners; §6 has the numbers.

Two coercions the data forces, stated once in `sqlValue()`: the
`:node/children` vector is stored as JSON text, and `sys.f.hidden`'s boolean
becomes 0/1 (`bun:sqlite` in non-strict mode accepts a raw boolean; wa-sqlite
refuses it).

### 5.4 Hand-rolled typed indexes — fastest, and not the answer

`Map<field, Map<value, Set<NodeId>>>` (AVET) + a per-field forward ref map + a
unioned reverse-reference map + a child→parent map, built straight from
`KbNode` with no datom expansion.

It wins every latency row: **cold build 327 ms at 1 M** (5× DataScript, 11×
SQLite), lowest memory (**463 MB RSS**, half the field), **0.002 ms** one-node
upsert, and closure in **0.15 ms — flat between 100 k and 1 M**, because it
walks only the component it reaches.

Why it is not the recommendation, honestly:

1. **Every question is code.** Q1/Q2/Q3/Q5/Q6 are one-liners, but Q4 and CL are
   ~45 hand-written lines of traversal in `run-maps.ts` — and the ninth question will be
   another 40. kb's public surface is *datalog*, and stored user data contains
   EDN (p1 §0: `sys.f.query`, `sys.f.onto.query`, `sys.f.targetQuery`,
   `sys.f.lens.query`, `sys.f.view.filter`, `.kb/queries/*.edn`, the WS
   `subscribe` protocol). An index with no query language cannot serve
   `graph.query`, whose input is arbitrary caller-authored EDN over MCP.
2. **No planner.** Q2's intersection order is hand-chosen here (drive the status
   bucket, probe the tag set). DataScript and SQLite pick a join order from the
   data; with maps every new question is a new hand-optimised plan, and the
   wrong one is silently 100× slower.
3. **No persistence.** Cold start is always a full rebuild — cheap at 327 ms,
   but it is a rebuild, and there is no snapshot format to add without inventing
   one.
4. **The reverse index cannot answer closure.** `backrefs` answers "who points
   at X"; "what does X reach" needs a forward adjacency, materialised separately
   and charged to load above (49 ms at 1 M). Any index must own both directions
   explicitly.

What it *is* good for, and worth keeping: it is the honest implementation of the
three or four hot paths that are not really queries — backlinks, tag membership,
substring search. Those are exactly what `KbIndex.search`, `getNode` and the
backlinks helper already are in p1's port. Keeping them as maps *inside* a
`SqliteIndex` is not a parallel path; it is one index answering its own fast
cases without a round trip.

### 5.5 Oxigraph — the model fits, the runtime does not

kb's data model maps onto RDF with no reshaping: node → IRI, scalar prop →
literal-valued triple, ref prop → IRI-valued triple, `:node/child` and
`:node/mentions` → triples. EAV *is* a triple store. And SPARQL 1.1 property
paths answer both recursive questions declaratively: `EXTENDS*` for Q4, and
`MENTIONS+` returns closure in **5.0 ms at 1 M**, flat across scales — the
cheapest closure of any candidate that speaks a real query language.

Against it:

- **No persistence in the JS build.** The `Store` constructor takes only quads;
  there is no `open(path)`. RocksDB exists in the Rust crate, the CLI and the
  server — not in the wasm bindings (verified by reading `node.d.ts` in
  `oxigraph@0.5.11`). So the brief's "RocksDB on native" is not reachable from
  Bun without writing an FFI/napi binding ourselves. The only persistence is
  dump/reload N-Quads: **2 144 ms to dump 95 MB, 1 212 ms to reload** at 1 M —
  strictly worse than the DataScript snapshot it would be replacing.
- **Memory is the worst of the field: 1 551 MB RSS at 1 M**, because the graph
  lives in wasm linear memory and every term is interned as a string IRI.
- **Bulk load has no array door.** `store.load()` takes serialised RDF, so the
  whole graph is rendered to 91 MB of N-Triples text (277 ms) before a 1 119 ms
  parse.
- **Scans are mid-pack**: Q1 84 ms, Q4 153 ms, Q6 37 ms at 1 M — 3× better than
  DataScript, 2–4× worse than SQLite.
- **A third dialect.** SPARQL is neither the stored EDN nor SQL, so the IR would
  need a third backend.

License and cadence are fine: MIT OR Apache-2.0, 0.5.11 current, wasm 4.05 MB
(node) / 4.05 MB (web), active through 2026. Recorded as the credible fallback
if path queries become a product need *and* the process can be long-lived. Not
now: no persistence, and 1.5 GB is disqualifying for a graph that is supposed to
grow.

### 5.6 DuckDB — the rejection expired, the mismatch did not

**New fact, dated.** p1 §0 rejects DuckDB on "open Bun crash", citing
`oven-sh/bun#17216`, closed as a duplicate of the then-open `#13910`.
**`#13910` is now closed** (it was a Linux-x64 intermittent segfault in DuckDB's
own bench script under Bun 1.1.27, opened 2024-09-12). And
`@duckdb/node-api@1.5.5-r.4` — the maintained TypeScript neo-package, not the
old `duckdb` addon — opens `:memory:`, reports `v1.5.5`, and evaluates a
`WITH RECURSIVE` CTE under **Bun 1.3.14 on darwin-arm64**. The stated reason for
the rejection no longer holds, so it was benchmarked.

It is a credible engine here: the **fastest cold build of any SQL candidate**
(194 ms at 100 k, **1 511 ms at 1 M**, via the Appender bulk path — index
creation is only 421 ms against SQLite's 2 257 ms), respectable query latency
(Q1 24 ms, Q4 30 ms, CL 13 ms at 1 M), and correct row counts throughout.

It still loses for the reason p1 already named — wrong shape — now with
specifics a `KbIndex` adapter would have to absorb:

- **No `ANY` column type.** Every datom value is stored as `VARCHAR` and cast at
  the join, so a numeric prop no longer round-trips through an index as a
  number.
- **No partial index.** `CREATE INDEX … WHERE ref = 1` is rejected, and there is
  no covering-composite equivalent of AVET/VAET; DuckDB leans on zone maps. The
  four-index EAV layout does not transfer, and it shows exactly where it should:
  backlinks costs **4.7 ms at 1 M against SQLite's 0.18 ms — a 26× regression on
  kb's hottest path**, and it does not improve from 100 k to 1 M, because it is
  scanning rather than probing.
- **A different dialect.** `json_each` does not exist; ordinality needs
  `unnest(from_json(…))` + `generate_subscripts`. Integer columns return
  `BigInt`, so the adapter needs its own revive step distinct from DataScript's
  eid revive.
- **Memory: 1 147 MB RSS at 1 M**, 45 % above SQLite.

Verdict: **no longer rejected on Bun grounds; still rejected on fit.** The
correction belongs in p1 §0 (§9 has the diff), because a stale fact in a
decision record is what gets the decision re-litigated from scratch next wave.

### 5.7 LadybugDB — alive, Cypher works under Bun, and reification is the price

**New fact, dated.** p1 §0 rejects Kuzu as "archived 2025-10-10" and its forks
as "too new, native addon, no Bun evidence". The fork is now
`@ladybugdb/core@0.20.2` (MIT, 132 published versions) with a **prebuilt
`darwin-arm64` addon** (`@ladybugdb/core-darwin-arm64`, 20.6 MB) and a wasm
build (`@ladybugdb/wasm-core@0.20.2`), publishing through 2026. Under
Bun 1.3.14 it `process.dlopen`s — after `bun pm trust`, since the platform
binary is copied by a postinstall script — and runs Cypher. So it was
benchmarked too.

It is the only candidate that answers the capability p1 §0 names as its second
revisit trigger — "path-as-value / shortest-path / bounded-depth queries become
a product need":

| | 100 k | 1 M |
|---|---|---|
| `MATCH p = (a)-[:MENTIONS* SHORTEST 1..5]->(b) RETURN length(p), b.id` | **2.1 ms**, 73 rows with real path lengths | **1.6 ms** |
| `MATCH p = (a)-[:MENTIONS* SHORTEST 1..30]->(b)` | 2.9 ms | 2.5 ms |
| Q5 children in order — native edge property `CHILD(…, ord INT64)` | 1.4 ms | 1.4 ms |
| reopen a built file (42 MB at 1 M) | 24.7 ms | **21.5 ms** |

Against it:

- **Fixed schema is the binding constraint, and it forces full reification.**
  `:f/<fieldId>` attributes are minted per field node at runtime, so there is no
  column to declare. Every prop becomes an edge:
  `SCALAR(FROM Node TO Node, value)` from the node to the *field node*, and
  `REFPROP(FROM Node TO Node, field)` from the node to the target. Measured at
  100 k: **47 470 edges for 11 889 nodes** (11 876 SCALAR + 14 311 REFPROP +
  17 356 MENTIONS + 3 927 CHILD); at 1 M, **469 368 edges**. This is the edge
  explosion the datalog-vs-cypher report predicted, now with a number. And a
  prop keyed by a field id that is not itself a node cannot be modelled at all.
- **Reification shows up in latency.** Q1 **481 ms** and Q4 **612 ms** at 1 M,
  where SQLite is 18 ms and 49 ms on the same questions — because every filter is
  a pointer hop through a reified edge instead of an index probe on a value.
  It is the slowest scan of any candidate measured, DataScript included.
- **Set reachability is not what a recursive rel pattern computes.** A plain
  `-[:MENTIONS*1..30]->` with `DISTINCT` on the endpoint **did not return within
  six minutes at 100 k**: it enumerates paths. `* SHORTEST` gives the reachable
  set in 43 ms (100 k) / 23 ms (1 M). "Cypher has variable-length paths" is true
  and does not by itself mean closure is cheap — the adapter would have to know
  to emit `SHORTEST`.
- **Incremental update is 10.0 ms** — three orders of magnitude off SQLite's
  0.025 ms — because a prop edit is a DELETE + CREATE of an edge.
- **Bulk load has no in-process door**: `COPY FROM` csv only, so the graph is
  written to five CSV files first, and node text containing newlines forces
  `PARALLEL=false` on the reader.
- **It does not release the event loop.** After the last query the process does
  not exit; `run-ladybug.ts` ends with an explicit `process.exit(0)`. Worth
  knowing before embedding a native addon in a long-lived server.
- Native addon, >20 MB prebuilt per platform, and a fourth query dialect.

Verdict: **rejection stands, on fit and maturity, not on liveness.** Record it
as *the* candidate to re-open if path-as-value becomes a product need — it is
the only one measured here that delivers it, and it delivers it in single-digit
milliseconds.

### 5.8 TerminusDB — daemon only; the versioning it sells is the versioning kb already has

Status check per the brief's addendum. **Not benchmarked**, because the
precondition ("no benchmark unless an in-process mode exists") is not met.
All facts dated, checked 2026-09-04.

**(a) Embeddable / in-process / wasm? No. Daemon only.**

- The core is **SWI-Prolog**, and still is: release **v12.0.7 (2026-08-10)**
  lists "upgrade SWI-Prolog to 10.0.2" among its maintenance changes. WOQL —
  the datalog-flavoured query language — is evaluated in Prolog.
- The Rust in the tree is not an embeddable database. `src/rust/Cargo.toml` is
  a workspace of `terminusdb-community`, **`terminusdb-store-prolog`** and
  `terminusdb-dylib`, pinned to `terminusdb-org/swipl-rs` — i.e. the storage
  layer is wired into SWI-Prolog through its foreign-language interface. There
  is no path that gives you the store without the Prolog runtime.
- **The published crate is stale, and the live one is unpublished.**
  `terminus-store` on crates.io is **0.21.5, 2024-03-11**, and its repo
  `terminusdb/terminusdb-store` was last pushed the same day
  (**2024-03-11**, not archived, Apache-2.0). The server does not use it: it
  git-pins `terminusdb-org/terminusdb-store` (last push **2026-07-30**) and
  `terminusdb-org/tdb-succinct` (**2026-07-04**), neither published to
  crates.io. So the piece that *looks* embeddable is a git-pinned fork consumed
  only through Prolog's FLI.
- Even if it were reachable, `terminus-store` is **storage only** — its own
  README says it "makes very few assumptions on what valid data is, only
  focusing on the actual storage aspect". No WOQL, no GraphQL, no path queries.
  Taking it would mean writing the query engine ourselves, which is Option B
  from `reports/recon-persistence.md` §3.2 wearing a different hat.
- **No wasm, no Bun binding.** The only JS artefact is
  **`@terminusdb/terminusdb-client@12.0.0`** (Apache-2.0), whose dependency list
  is `axios`, `form-data`, `follow-redirects`, `node-forge`, `pako` — an HTTP
  client. "Browser and Node.js support" in its README means it can *call* a
  server from either, not run one.
- Deployment in the v12 documentation is Docker Compose, exclusively.

**Consequence, stated as the addendum asks: TerminusDB lands in the
Memgraph / Neo4j / TypeDB / SurrealDB bucket of p1 §0** — a daemon that cannot
run inside the browser UI, and cannot be reached from kb's synchronous
`KbIndex` reads without the wide async change p1 2a explicitly defers and files
as a `#gap`. Every read would be an axios round trip.

**(b) Maintenance 2025–26: healthy, and that is not the problem.**

- **DFRNT assumed maintainership during 2025** (stated in the
  2025-12-08 "TerminusDB 12" post), after the company's pivot to TerminusCMS.
  Commercial support is sold by DFRNT.
- Release cadence is real: v12.0.0 (2026-02-24) through **v12.0.7
  (2026-08-10)**, with v12.0.6 on 2026-06-24; the repo was last pushed
  **2026-09-03**. v12.0.7 credits three new contributors and ships explicit
  diffs plus an `unfold` parameter on the diff API.
- **License: Apache-2.0** for the server, the JS client and the store crate.
- This is the one rejected candidate in this report that is *not* rejected for
  being dead. It is rejected for shape.

**(c) The versioning overlap — and why it cannot be a derived cache.**

TerminusDB's pitch is a commit graph over the data: branch, diff, merge, push,
pull, time travel, stored as immutable delta layers with their own `_commits`
graph. kb already has every one of those, from git over a line-per-node
canonical JSONL — with per-node line diffs, authorship, real 3-way merge, and
`reports/recon-persistence.md` §4's analysis of why that layout is the right
one. The overlap is not partial; it is the whole feature.

That produces a fork with no good branch:

- **As a derived, rebuildable cache** (the only thing p1 §0 allows beside the
  JSONL) it is *technically* possible — gitignore the store, fingerprint it,
  rebuild on mismatch — and **pointless**, because a rebuilt store has a commit
  graph one commit deep. Branch, diff and merge would all be answering
  questions about the rebuild, not about the data's history. You would be
  running a versioned database whose version history is a rounding artefact,
  and paying a daemon for it.
- **As truth** it violates p1 §0's first bullet outright ("JSONL is the only
  committed source of truth"), and leaves **two commit graphs with no
  mechanical bridge** — git's and TerminusDB's — which is precisely the
  "two copies kept in sync by hand" that Rule 1 names as drift waiting to
  happen. "Double persistence" here is not two stores; it is **two
  histories**, and there is no `git merge` that understands the other one.
- A third option — TerminusDB as truth with a JSONL *export* for git — is what
  Logseq DB ended up doing (`recon-persistence.md` §2.4), and the report
  already records why that is the half of Logseq's architecture they had to
  work around.

**Verdict: reject, and record it in the daemon bucket of p1 §0 rather than the
dead bucket.** The right note for a future reader is not "TerminusDB is
unmaintained" — it is well maintained — but "TerminusDB's git-for-data is the
feature kb already gets from git, and taking it means either a second history
or a hollow one." Re-open only if kb ever wants versioning semantics git cannot
express — per-branch schema migration, or diffs *as query results* — and even
then the daemon and the browser story have to be solved first.

---

## 6. The browser story

The brief asks whether the same EAV schema and SQL run in the browser. **They
do, unchanged** — `bench/lib/sql.ts` is imported by the Bun runner and by both
browser runners, so a statement that needed rewriting would fail to compile
rather than quietly diverge. Row counts match the Bun run exactly at both
scales.

|  | `sql.js` 1.14.2 (memory) | `wa-sqlite` 1.0.0 (OPFS) |
|---|---|---|
| bundle (minified / gzip) | 48 514 B / 18 004 B | 67 705 B / 22 820 B |
| wasm (raw / gzip) | 658 410 B / 326 008 B | 558 343 B / 276 426 B |
| wasm init | 17–23 ms | 8–9 ms + 14 ms VFS create |
| build index @ 100 k | 530 ms | 2 702 ms |
| build index @ 1 M | 4 406 ms | **30 357 ms** (index creation alone 24 920 ms) |
| Q1 @ 100 k / 1 M | 2.1 / 25 ms | 2.9 / 146 ms |
| closure @ 100 k / 1 M | 4.3 / 9.8 ms | 4.7 / 107 ms |
| JS heap @ 1 M | **1 020 MB** | n/a (wasm + OPFS) |
| durable across reload | **no** — `export()` yields 270 MB of bytes the page must store itself | **yes** |
| reopen + count @ 100 k / 1 M | n/a | **72 ms / 700 ms**, all 1 000 004 rows present; Q1 then 12 ms / 150 ms |
| FTS5 | **absent** — `no such module: fts5` | **absent** — `no such module: fts5` |

Four things fall out:

1. **Neither browser build has FTS5.** Both fail with `no such module: fts5`, so
   BM25 search is a *server-side* capability unless we compile our own SQLite.
   Worth knowing before designing search as a client feature, and it strengthens
   p1 §4's decision to gate FTS5 rather than assume it.
2. **`wa-sqlite` on OPFS is the only candidate anywhere that gives the browser a
   durable index with zero rebuild.** Reopen at 1 M is 700 ms and queries then
   work at 150 ms. A DataScript snapshot in the browser would be a 46 MB JSON
   parse into a 1 GB heap on **every** page load.
3. **Building the index in the browser at 1 M is not viable** — 30 s for
   wa-sqlite, 4.4 s for sql.js with a 1 GB heap. Which is the conclusion p1 §2g
   reaches from the other direction: the browser should not hold the whole
   graph. The right shape is the server building the index and the browser
   subscribing; if the browser does keep a local cache, OPFS + wa-sqlite means
   it builds once, not once per page load.
4. **OPFS requires cross-origin isolation.** `COOP: same-origin` +
   `COEP: require-corp` are set by the bench server and `crossOriginIsolated` is
   asserted `true` in the results. `kb ui`'s `Bun.serve` does not send those
   headers today; adding them is one header pair, but it also breaks any
   non-CORP-enabled cross-origin subresource, so it is a real (small) decision,
   not a free switch.

---

## 7. Recommendation

**Own a `SqliteIndex` behind p1's `KbIndex` port, and delete p1 Phase 3 to pay
for it.**

Three sentences, as the brief asks:

> `bun:sqlite` over a four-index EAV table is the only candidate that improves
> all four measured axes at once — 14× on scans, **294× on closure**, 150× on
> cold start with a built index, 27× on incremental update, at the same memory
> (790 MB RSS against 824 MB) — while adding zero runtime dependencies, keeping
> JSONL as the only committed truth, and running the *same SQL unchanged* in the
> browser on OPFS. It is worth owning the
> adapter now, because its entire cost is the query-IR→SQL compiler that p1
> Phase 2f already has to build for DataScript, and building the second backend
> against the first is the only thing that proves the IR is actually an
> abstraction rather than a DataScript wrapper with extra steps. Pay for it by
> dropping p1 Phase 3: the snapshot cache optimises cold start, which is the one
> metric a hosted tailnet process never pays, and it leaves every query latency
> exactly where it was — 2.1× at 1 M, measured in the same process.

### 7.1 The `KbIndex` adapter shape this implies

p1 Phase 2a's port needs **no change** to admit this. It already has the right
methods; the adapter fits as written:

```ts
// src/foundation/index/sqlite.ts — a second implementation of p1 2a's port
export class SqliteIndex implements KbIndex {
  // Derived cache, never truth. Says so in the type, per p1 §0.
  private constructor(private readonly db: Database, private readonly ids: EidMap) {}

  static openDerived(opts: { cachePath: string; fingerprint: SourceFingerprint }): SqliteIndex | undefined;
  //     ^ returns undefined on any mismatch; the caller rebuilds. Rebuild is
  //       always correct, so a missing/stale/corrupt cache is never fatal.

  readonly generation: number;
  rebuild(nodes: ReadonlyArray<KbNode>): void;   // one transaction: datoms + node + indexes
  applyTx(tx: StoreTx): void;                    // DELETE ... WHERE e=? AND a=? / INSERT
  run(ir: QueryIR): Rows;                        // <- p1 2f. THIS is the whole cost.
  runDatalog(edn: string, ...i: unknown[]): never;  // declines, per p1 2f's contract
  pull(pattern: string, id: NodeId): unknown;    // json_each over `node.doc`
  getNode(id: NodeId): KbNode | undefined;       // point read on node(id)
  allNodes(): Iterable<KbNode>;                  // streamed cursor, not an array
  search(text: string, limit?: number): Array<KbNode>;  // FTS5 where available, LIKE otherwise
  withVirtual(nodes: ReadonlyArray<KbNode>): void;      // a `virtual` flag column on datoms
}
```

Five specifics the measurements pin down:

1. **`run(ir)` is the deliverable; `runDatalog(edn)` declines.** p1 2f already
   documents `runDatalog` as the engine-specific raw surface that "an engine
   adapter later … may decline". That is exactly right, and it means
   `graph.query`'s arbitrary-EDN-over-MCP surface keeps working *on the
   DataScript index* while everything that goes through the IR — operations,
   render, ontology, the subscription hub — can be served by either. Both
   indexes coexist behind one port with one owner; that is not a parallel path,
   it is the port doing its job.
2. **The IR needs one clause the current stored queries do not have: recursion
   as a first-class node.** Today closure is expressed as a caller-supplied
   `%` rules vector, which is a DataScript surface. The IR must carry
   `{ kind: "reach", from, edge, minHops?, maxHops?, returnPath? }` so it can
   compile to a `WITH RECURSIVE … UNION` for SQLite, a `reach` rule for
   DataScript, a property path for SPARQL and `* SHORTEST` for Cypher. The
   datalog-vs-cypher report's open question 3 asked for exactly this; the
   measurements say it is not optional, because the naive compilations differ
   by three orders of magnitude: at 1 M, for the same 2 059 rows — SQLite
   `UNION` 5.4 ms · SPARQL property path 5.0 ms · Cypher `SHORTEST` 23 ms ·
   Cypher naive path enumeration **>6 min** · DataScript fixpoint 1 570 ms.
3. **Eid stability is a shared prerequisite, not extra work.** p1 2b already
   requires monotonic non-positional eids and persisting the map. SQLite needs
   the identical thing and stores it in the same file (`node(id, e, doc)`),
   which removes p1 Phase 3's separate `ids.json`.
4. **The four indexes are the schema, and VAET must be partial.**
   `datoms(e,a,v,ref)` with unique `(e,a,v)`, `(a,e,v)`, `(a,v,e)`, and
   `(v,a,e) WHERE ref = 1`. The partial predicate is not a micro-optimisation:
   it is why backlinks is 0.18 ms at 1 M against DuckDB's 4.7 ms on the same
   question, and it is the index kb's hottest read path lives on.
5. **`search` gets a real answer, with a gate.** FTS5 gives BM25 ranking that
   `graph.search`'s substring scan cannot. It is available in `bun:sqlite` and
   **absent from both browser builds**, and the macOS `close()` segfault
   (oven-sh/bun#37044) is open. So: FTS5 behind a capability probe, `LIKE`
   fallback, and never call `close()` — which a long-lived process does not
   anyway.

### 7.2 What it costs to own

Honestly, and separating what is new from what p1 already committed to:

| item | new work? | size |
|---|---|---|
| `KbIndex` port, `withVirtual`, generation, stable eids | **no** — p1 Phase 2a/2b | — |
| query IR + `parseEdn`/`compile` + stored-form migration | **no** — p1 Phase 2f | the wave's biggest item either way |
| `reach` clause in the IR | small addition to 2f | ~1 clause + 1 compiler case per backend |
| `SqliteIndex` (schema, rebuild, applyTx, pull, getNode, search) | **yes** | `bench/lib/sql.ts` is **128 lines** for the eight questions by hand; the general `run(ir)` → SQL compiler is the same order as the DataScript one it sits beside |
| fingerprint + cache invalidation | **no** — p1 Phase 3's protocol, reused verbatim; only the artefact changes from `db.snapshot.json` to `index.sqlite` | — |
| COOP/COEP headers on `kb ui` if the browser gets a local OPFS cache | yes, later | one header pair, one decision |
| **removed:** `d.serializable` snapshot, `ids.json`, snapshot `schemaVersion` test | — | p1 Phase 3 in full |

Net: the new code is one `KbIndex` implementation and one more compiler
backend. The removed code is a whole phase. That is why the answer to "is it
worth owning now" is yes — *now* is when the IR is being designed, and a
second backend is the only proof the design works.

### 7.3 What this does not change

- **JSONL stays the only committed source of truth.** `index.sqlite` lives in
  `.kb/cache/`, gitignored, fingerprinted, deletable. p1 §0's third bullet is
  untouched, and `openDerived` returning `undefined` is how the type says so.
- **DataScript stays.** It is the datalog surface, it is the browser's local
  engine today, and `runDatalog` needs it. This is not a migration; it is a
  second implementation of a port that p1 is building anyway.
- **The EDN dialect stays public.** Nothing here requires stored EDN to change
  beyond what p1 2f already migrates.

---

## 8. Two defects found while benchmarking

Neither is a benchmark artefact; both are in `tools/kb` today.

1. **A caller-supplied rules vector is never normalized.**
   `packages/query/src/datascript.ts` `query()` runs `normalizeEdnQuery` on the
   query string only. Rules arrive as an `:in $ %` *input*, so a rules vector
   containing `:f/…` or `:node/…` keeps its keywords while the datoms hold
   strings, and DataScript throws mid-fixpoint:
   `Cannot compare :node/created-at to :f/sys.f.onto.extends`. That is reachable
   from `graph.query` and `graph.run` — i.e. from MCP — with any recursive rule,
   which is the documented way to ask for closure. The fix is one line
   (normalize every string input, or normalize rules explicitly) and belongs
   wherever p1 2f puts the compiler, since `normalizeEdnQuery` is getting one
   home there anyway. Reproduced in
   [`bench/run-datascript.ts`](./bench/run-datascript.ts) — the first version
   of Q4 failed exactly this way.
2. **`:node/child-order` cannot be joined to `:node/child`.** Both are datoms
   on the parent, so `[?p :node/child ?c] [?p :node/child-order ?ord]` is a
   cartesian product: 36 children × 36 orders = 1 296 rows. Anything that
   currently asks datalog for ordered children is either wrong or is silently
   relying on the `:node/children` vector instead. `reports/datalog-vs-cypher`
   filed this as open question 2; this report supplies the row count. The IR
   should express "children, in order" as a projection of the vector, not as a
   join — and `nodeToDatoms` should probably stop emitting `:node/child-order`
   at all, since nothing can use it correctly.

---

## 9. Proposed diff to `briefs/p1-persistence.md` §0

Per the brief, this report does **not** edit `p1-persistence.md`. Here is the
diff it proposes.

### 9.1 Replace the revisit trigger

```diff
 - **DataScript is the only query engine today, behind two boundaries.** The
   EDN dialect is public API *and* stored user data; changing it is a data
   migration *unless the stored form is kb-owned* — so this wave introduces a
   **query IR** (Phase 2f) and makes the engine an adapter. No hand-rolled
   datalog→SQL compiler, no fork of DataScript. Revisit trigger (plan D10):
-  the hosted everything-KB approaches ~1 M datoms (≈120–140 k nodes, ≈400 MB
-  in-process at the measured 380 B/datom), or path-as-value / shortest-path /
-  bounded-depth queries become a product need (datalog returns endpoints only;
-  demo in plan D3).
+  **superseded by measurement — see `reports/backend-recon/README.md`.** The
+  memory trigger is wrong: at 1 M datoms (117 866 nodes, measured) DataScript
+  holds 320 MB of JS heap and `bun:sqlite` 348 MB, so memory does not
+  discriminate. The trigger that actually fires is **query latency**, and it
+  fires an order of magnitude earlier:
+    - **transitive closure: already unusable at 100 k datoms** (11 889 nodes).
+      DataScript's recursive rule takes 791 ms at 100 k and 1 570 ms at 1 M to
+      return the same 2 059 rows; SQLite `WITH RECURSIVE` answers in 3.5 /
+      5.4 ms. Cost grows with the graph, not the answer.
+    - **tag/status scans: 44 ms at 100 k, 260 ms at 1 M** for a `#todo` scan
+      (52 162 rows), and 386 ms for transitive tag inheritance. The
+      subscription hub re-runs every live query on every change, so this is
+      per-edit cost.
+    - **cold index build: 1 619 ms at 1 M, 77 % of it `d.init_db`** — and there
+      is no reopen path at all, so it is paid on every cold start.
+  Path-as-value / shortest-path / bounded-depth stays a trigger and now has a
+  named destination: **LadybugDB** answers it in 1.6–2.9 ms (measured, both
+  scales), and is the only candidate that answers it at all.
```

### 9.2 Correct two rejections

```diff
 - **Rejected with evidence** (do not re-open without new facts): CozoDB (last
   release 2023-12, maintenance unanswered), Kuzu (archived 2025-10), Mentat
   (dead; the exact datalog→SQLite blueprint), DataScript lazy `storage` from JS
   (throwing stub in 1.7.8 and 1.8.1), Logseq's fork (opaque Transit blobs;
   their own git answer is "export markdown"), Datahike/XTDB/Datalevin (JVM),
   Memgraph/Neo4j/TypeDB/SurrealDB (daemons; cannot run in the browser UI;
   BSL for two of them), PGlite (WASM Postgres per CLI invocation), DuckDB (open
-  Bun crash), Automerge/Yjs (binary, undiffable, no queries), TinyBase (no
+  Bun crash), Automerge/Yjs (binary, undiffable, no queries), TinyBase (no
   transitive traversal), Triplit/RxDB/Electric/Zero (license, inactivity, or
   needs Postgres).
+
+  **Two entries corrected 2026-09-04 with new facts (r4-backend-recon §5.6,
+  §5.7):**
+  - **DuckDB — the Bun blocker is gone.** `oven-sh/bun#13910` is closed;
+    `@duckdb/node-api@1.5.5-r.4` opens, queries and runs recursive CTEs under
+    Bun 1.3.14 / darwin-arm64, and was benchmarked. Still rejected, on **fit**
+    rather than crashes: no `ANY` column type, no partial index (so no
+    AVET/VAET — backlinks regresses 26× against SQLite, 4.7 ms vs 0.18 ms at
+    1 M), a different JSON dialect, BigInt results, 45 % more memory.
+  - **Kuzu → LadybugDB — the fork is alive and works on Bun.**
+    `@ladybugdb/core@0.20.2` (MIT, 132 versions, prebuilt darwin-arm64 addon,
+    `@ladybugdb/wasm-core` for the browser) loads under Bun and runs Cypher
+    including `length(p)` and `* SHORTEST`. Still rejected for **now**, on the
+    fixed schema: `:f/<fieldId>` attrs are minted at runtime, so every prop
+    must be reified into an edge — measured 469 368 edges at 1 M — which costs
+    481 ms on a `#todo` scan against SQLite's 18 ms (the slowest scan of any
+    candidate measured, DataScript included) and 10 ms per single-prop write. **Re-open when path-as-value becomes a product need**:
+    it is the destination for that trigger.
+  - **CozoDB re-verified 2026-09-04: still v0.7.6 (2023-12-11), no later
+    release. Rejection stands unchanged.**
+  - **TerminusDB added to the daemon bucket, not the dead one
+    (r4-backend-recon §5.8).** Well maintained — DFRNT took over
+    maintainership in 2025, v12.0.7 shipped 2026-08-10, Apache-2.0 — but the
+    core is SWI-Prolog and there is no embeddable or wasm mode: the Rust
+    storage layer is bound in through Prolog's FLI
+    (`terminusdb-store-prolog` + `swipl-rs`), the published `terminus-store`
+    crate is stale at 0.21.5 / 2024-03-11, and `@terminusdb/terminusdb-client`
+    is an axios HTTP client. So it cannot run in the browser UI and cannot
+    serve kb's synchronous `KbIndex` reads. Separately and independently: its
+    git-like commit graph is the feature kb already gets from git over
+    line-per-node JSONL, so as a *derived rebuildable* cache its history would
+    be one commit deep (hollow), and as truth it would be a second commit
+    graph with no mechanical bridge to git's — the hand-synced mirror Rule 1
+    forbids. Re-open only for versioning semantics git cannot express.
+  - `bun:sqlite` moves from "index + write sidecar" to **the recommended
+    second `KbIndex` implementation** — see §9.3.
```

### 9.3 Replace Phase 3

```diff
-### Phase 3 — derived snapshot cache (1–2 days, opt-in; **last, and only if CLI cold start still matters**)
-
-Plan D10 lowers this phase: a hosted, long-lived `kb` process never pays cold
-start, and the CLI-as-client item in §4 removes it for interactive use. Do it
-only if, after Phases 1–2, cold `kb <cmd>` on the real graph size is measured
-to hurt. The design stands as written.
+### Phase 3 — `SqliteIndex`, a second implementation of the port (2–3 days)
+
+**Supersedes the `d.serializable` snapshot cache** (r4-backend-recon §5.2, §7):
+the snapshot was measured at **2.1×** on cold load at 1 M (727 ms vs a 1 501 ms
+rebuild in the same process) and **0× on everything else** — same query latency, same 46 MB re-serialised per
+commit — and cold load is the one metric a hosted tailnet process never pays.
+
+`SqliteIndex` is a `KbIndex`, not a `KbStore`: a derived, fingerprinted,
+gitignored cache in `.kb/cache/index.sqlite` that `openDerived()` returns
+`undefined` for on any mismatch, so rebuild stays the definition of correct.
+Schema: `datoms(e, a, v, ref)` with unique `(e,a,v)`, `(a,e,v)`, `(a,v,e)` and
+**partial** `(v,a,e) WHERE ref = 1`, plus `node(id, e, doc)` for point reads and
+the eid map, plus FTS5 behind a capability probe.
+
+It implements `run(ir)` and **declines `runDatalog(edn)`**, exactly as Phase 2f
+says an adapter may. DataScript keeps serving the raw-EDN surface. The IR gains
+one clause — `reach { from, edge, minHops?, maxHops?, returnPath? }` — because
+the naive per-engine compilations of closure differ by three orders of
+magnitude and the IR is the only place that knowledge can live.
+
+Keep from the old Phase 3, verbatim: the fingerprint protocol
+(`Bun.hash` + byte length + node count + a builder-derived `schemaVersion`
+with a test that fails when `nodeToDatoms` changes without a bump), the
+write-inside-the-same-lock rule, `KB_NO_CACHE=1`, and `kb cache
+rebuild|clear`. Only the artefact changes: `index.sqlite` instead of
+`db.snapshot.json` + `ids.json`.
+
+Measured targets to assert in Phase 4, at 1 M datoms: reopen a built index
+≤ 40 ms (measured 10.8 ms); `#todo` scan ≤ 60 ms (measured 18 ms); transitive
+closure ≤ 20 ms (measured 5.4 ms); one-node update ≤ 1 ms (measured 0.025 ms).
```

### 9.4 Add to §4 "explicitly not now"

```diff
+- **FTS5 is server-only.** Both browser SQLite builds (`sql.js` 1.14.2 and
+  `wa-sqlite` 1.0.0) report `no such module: fts5`, so a client-side search
+  index needs a custom SQLite build. Gate stays on oven-sh/bun#37044 for the
+  server side (never call `close()`), and on a custom build for the browser.
+- **Browser-local OPFS index.** `wa-sqlite` + `AccessHandlePoolVFS` is the only
+  measured way to give the browser a durable index with zero rebuild (reopen
+  700 ms at 1 M, all 1 000 004 rows present, Q1 then 150 ms). It needs `kb ui` to send
+  `COOP: same-origin` + `COEP: require-corp`. Belongs in
+  `u1-ui-through-protocol.md`, not here.
```

---

## 10. Reproducing

```bash
cd docs/kb/waves/2026-09-03/reports/backend-recon/bench
bun install
./run-all.sh            # regenerates fixtures, runs every candidate serially, prints the tables
```

`run-all.sh` is one serial pass on purpose: two candidates running concurrently
skewed an early draft's `sqlite-mem` cold-load figure by 4×. Raw per-run JSON
lands in [`bench/results/`](./bench/results); `bun report-tables.ts` renders §1
and §4 from it, so the report's numbers cannot drift from the runs.

Fixtures (`bench/data/*.jsonl`, 4.3 MB and 42.8 MB) and built indexes are
regenerated deterministically and are **not committed** — see
`bench/.gitignore`.

### Versions

| | |
|---|---|
| Bun | 1.3.14 (darwin-arm64) |
| `datascript` | 1.8.1 (kb's catalog now pins `^1.8.1`; p1's numbers were taken on 1.7.8) |
| SQLite via `bun:sqlite` | 3.51.2 |
| `@duckdb/node-api` | 1.5.5-r.4 (DuckDB v1.5.5) |
| `oxigraph` | 0.5.11 (MIT OR Apache-2.0) |
| `@ladybugdb/core` | 0.20.2 (MIT) |
| `sql.js` | 1.14.2 |
| `wa-sqlite` | 1.0.0 |
| `playwright-core` | 1.62.1, driving cached `chromium_headless_shell-1228` |

### Sources

- DataScript — <https://github.com/tonsky/datascript> · <https://www.npmjs.com/package/datascript>
- Bun SQLite — <https://bun.com/docs/runtime/sqlite> · FTS5 `close()` segfault <https://github.com/oven-sh/bun/issues/37044>
- Datomic index model (EAVT/AEVT/AVET/VAET) — <https://docs.datomic.com/indexes/index-model.html>
- DuckDB/Bun crash, **now closed** — <https://github.com/oven-sh/bun/issues/13910> (dup target of <https://github.com/oven-sh/bun/issues/17216>) · `@duckdb/node-api` <https://www.npmjs.com/package/@duckdb/node-api>
- Oxigraph — <https://github.com/oxigraph/oxigraph> · npm <https://www.npmjs.com/package/oxigraph> · changelog <https://github.com/oxigraph/oxigraph/blob/main/CHANGELOG.md>
- LadybugDB — <https://github.com/LadybugDB/ladybug> · <https://github.com/LadybugDB/ladybug-nodejs> · <https://github.com/LadybugDB/ladybug-wasm> · npm <https://www.npmjs.com/package/@ladybugdb/core> · <https://www.npmjs.com/package/@ladybugdb/wasm-core> · docs <https://docs.ladybugdb.com/installation/> · v0.12.0 release <https://github.com/LadybugDB/ladybug/releases/tag/v0.12.0> · Kuzu archival context <https://gdotv.com/blog/kuzu-legacy-embedded-graph-database-landscape/>
- CozoDB, **re-verified still v0.7.6 / 2023-12-11** — <https://github.com/cozodb/cozo/releases> · maintenance issue <https://github.com/cozodb/cozo/issues/301>
- TerminusDB — <https://github.com/terminusdb/terminusdb> (Apache-2.0, last push 2026-09-03) · v12.0.7 release 2026-08-10 <https://github.com/terminusdb/terminusdb/releases> · "TerminusDB 12" / DFRNT maintainership 2025-12-08 <https://terminusdb.org/blog/2025-12-08-terminusdb-12-release/> · docs <https://terminusdb.org/docs/> · JS HTTP client <https://www.npmjs.com/package/@terminusdb/terminusdb-client> · store crate (stale, 0.21.5 / 2024-03-11) <https://crates.io/crates/terminus-store> · <https://github.com/terminusdb/terminusdb-store> · live unpublished fork <https://github.com/terminusdb-org/terminusdb-store> (last push 2026-07-30) · <https://github.com/terminusdb-org/tdb-succinct> · <https://github.com/terminusdb-org/swipl-rs>
- `sql.js` — <https://github.com/sql-js/sql.js>
- `wa-sqlite` + OPFS `AccessHandlePoolVFS` — <https://github.com/rhashimoto/wa-sqlite> · <https://github.com/rhashimoto/wa-sqlite/discussions/67>
- Cross-origin isolation for OPFS sync access handles — <https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle>
