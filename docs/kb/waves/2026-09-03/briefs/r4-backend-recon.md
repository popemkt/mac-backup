# r4-backend-recon — measured exploration of a performant index/backend for kb

Track 2 recon. Harness: claude. Branch from `kb-wave/2026-09-03`. **Read-only
with respect to `tools/kb/packages/**`**: no source change, no dependency added
to any package. Everything you build lives under
`docs/kb/waves/2026-09-03/reports/backend-recon/` (scripts, raw numbers,
report) and may have its own `package.json` + lockfile for the candidates you
benchmark. Commit on your branch; never push. Run `intent/gate.sh session
claude-code` first.

Read first: `briefs/p1-persistence.md` **all of it** — §0 is the decision
record with the rejected list (do not re-open a rejection without a *new
fact*, and if you find one, say exactly what changed and when); §2 is the
target shape (`KbIndex` port, JSONL stays truth, index is a derived cache);
§3 Phase 2 is what your recommendation must plug into. Then
`reports/measurements.md` §"DataScript" (the 50k-node numbers: 411 ms init,
380 B/datom, 7–8 datoms/node), `reports/datalog-vs-cypher/README.md` and
`demo-cypher.md` (the six reference questions Q1–Q6 plus the path demo),
`reports/recon-kb.md` B.9 (today's load path), `tools/kb/DESIGN.md`
"Storage" and "Ratchet scope".

## 0. The question

The owner wants a hosted everything-KB (Tana-like) on the tailnet. The p1
trigger says "revisit at ~1 M datoms". Answer, with numbers on kb's *own*
graph shape: **which index/backend gives the best cold-load, memory, query
latency and incremental-update profile at 100 k / 1 M datoms, in both Bun and
the browser, while keeping JSONL as truth and the index as a rebuildable
cache — and is it worth owning a `KbIndex` adapter for it now?**

## 1. Candidates (measure each; drop one only with a reason)

1. **DataScript as-is** (baseline; also DataScript with the batched-decode
   fix from p1 Phase 1 if it is cheap to prototype in the scratch dir).
2. **`bun:sqlite` EAV store**: one `datoms(e,a,v,t)` table with the four
   covering indexes (EAVT, AEVT, AVET, VAET-for-refs), Q1–Q6 as SQL,
   transitive closure as `WITH RECURSIVE`, FTS5 over `node/text`. Measure
   in-memory and file-backed. Then the **browser story** for the same
   schema: `wa-sqlite` (OPFS) and/or `sql.js` — bundle size, load time, and
   whether the same SQL runs unchanged.
3. **Oxigraph** (`oxigraph` npm — Rust RDF store with SPARQL 1.1, wasm build
   for browser, RocksDB on native): kb's node/props/children as triples;
   Q1–Q6 in SPARQL; property paths (`+`, `*`) for closure; memory and wasm
   size; license (Apache/MIT) and release cadence in 2026.
4. **Hand-rolled typed indexes**: `Map<attr, Map<value, Set<eid>>>` +
   forward EAV + reverse ref index, built straight from `KbNode` (skip the
   datom expansion), incremental `upsert`/`retract`, and the six questions as
   plain TS over those maps. This is the "own the 200 lines" option; measure
   it honestly, including how ugly Q4 (tag inheritance) and closure get.
5. **Status checks, no benchmark unless alive**: LadybugDB (the Kuzu fork —
   releases in 2026? Bun/Node binding? wasm?), DuckDB under the *current* Bun
   (p1 recorded an open crash — re-test once, cite the issue), CozoDB (any
   2025–26 release?). One paragraph each with dates and links.

## 2. Method

- Dataset: kb's real `.kb/nodes.jsonl` shape, scaled synthetically to
  ~100 k and ~1 M datoms with the measured 7–8 datoms/node, realistic
  fan-out for `children` and `:node/mentions`, and the `sys.*` tag/field
  nodes present. Write the generator once; every candidate loads the same
  file.
- Metrics per candidate, per scale: cold load from JSONL (ms), resident
  memory delta (MB), Q1–Q6 + backlinks + transitive closure latency (ms,
  p50 over 20 runs), incremental update of one node (ms), rebuild-from-cache
  if the candidate has persistence, and for the browser: wasm/bundle size and
  load time in headless Chromium (or state clearly that you could not run it
  headless).
- Report numbers in tables; keep raw JSON of every run beside the report.
  Cite versions of everything.
- Everything under §0's constraints: JSONL truth, derived cache, EDN dialect
  stays public (so note per candidate what a query IR → candidate adapter
  would need — p1 Phase 2f).

## 3. Deliverables

`docs/kb/waves/2026-09-03/reports/backend-recon/`:
- `README.md` — the report: findings table, one recommendation with the
  concrete `KbIndex` adapter shape it implies, what it costs to own, the
  revisit triggers it replaces in p1 §0, and the rejections with evidence.
- `bench/` — generator, one runner per candidate, raw results.
- Anything that changes a p1 decision is written as a proposed diff to
  `briefs/p1-persistence.md` §0 in the report — do **not** edit the brief.

Reply when done with: branch, head sha, the findings table, the
recommendation in three sentences, and any owner decision it needs.

## Addendum (owner, 2026-09-04) — TerminusDB

Add to §1.5 (status checks, no benchmark unless an in-process mode exists):
**TerminusDB**. The owner finds it compelling: git-like graph history
(branch/diff/merge/push), JSON-LD schema, WOQL path queries, GraphQL. Answer
with dates and links: (a) is there any embeddable / in-process / wasm mode, or
is it a daemon only (SWI-Prolog core + `terminusdb-store` Rust crate)? Bun or
browser binding beyond the HTTP client? (b) maintenance in 2025–26 — the
company's pivot to TerminusCMS, who releases now (DFRNT?), last release date;
(c) how its versioning overlaps what kb already gets from git + line-per-node
JSONL, and what "double persistence" would mean if TerminusDB were the index
(it wants to be truth with its own commit graph — say plainly whether it can
be a *derived, rebuildable* cache under p1 §0). If (a) is "daemon only", it
lands in the Memgraph/Neo4j bucket; say so and do not benchmark it.
