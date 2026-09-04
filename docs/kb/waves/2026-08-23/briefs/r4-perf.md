# Brief r4 — Storage/performance architecture research (no code)

Agent: codex. RESEARCH ONLY — explicitly no implementation tonight.

## Mission

Owner requirement: kb's datastore must become "as reliable as a db" long-term
as the codebase and dataset grow. Today everything is append-only JSONL
(`.kb/nodes.jsonl`) loaded into memory (DataScript on server + UI). Produce the
durable engineering study + staged roadmap. Do NOT implement anything.

## Read first

- `tools/kb/DESIGN.md` (store, datalog, registry, subscriptions)
- `tools/kb/src/foundation/**` (store + query internals)
- `tools/kb/src/surface/**` (HTTP/WS, CLI persistence paths)
- `tools/kb/tests/benchmark.test.ts` — current perf baseline
- `tools/kb/DESIGN-REFINE.md`

## Research questions

1. Durability & crash safety: what happens today on crash mid-write? Evaluate:
   fsync strategy, WAL framing for JSONL, checksummed segments, atomic rotate,
   snapshot + compaction design. What would make writes crash-proof without a
   storage engine dependency?
2. Scale envelope: project costs at 10k / 100k / 1M nodes × fields/tags/props.
   Load time, memory (server DataScript + UI clone), query latency, WS fanout.
   Where does JSONL+full-reload break?
3. Engine options (evaluate honestly, incl. staying-the-course):
   custom segmented log + in-memory indexes; SQLite (WAL) as the store with
   datalog layer above; LMDB/sled-style embedded KV; keeping JSONL + periodic
   snapshot. Criteria: durability guarantees, migration cost, Bun fit, backup
   friendliness (this repo Mackup-backs `.kb/`), agent-write concurrency.
4. Query path: where should indexes live so UI stays responsive? Server-side
   incremental evaluation vs client clone refresh; subscription invalidation
   granularity.
5. Concurrency model: multiple writers (CLI + MCP + UI) — current story, ideal
   story (single-writer broker? MVCC?), migration steps.
6. Migration story: additive path from today's file format; how TODO/user data
   survives every step (hard owner requirement).

## Deliverable

`docs/kb/waves/2026-08-23/reports/r4-perf.md`: Current-state analysis / Failure
modes / Scale projections with numbers / Option matrix with recommendation /
Staged roadmap (stage 0 keep-course hardening → …), each stage independently
shippable / Open questions for owner. Include concrete benchmarks to add later.

## Constraints

- `./intent/gate.sh session codex` first.
- Touch nothing except your report file. No commits.
