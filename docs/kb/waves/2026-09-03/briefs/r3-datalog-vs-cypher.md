# r3-datalog-vs-cypher — explainer + runnable demos (research/docs wave)

Harness: **omp**. Research and writing only. You may write **only** under
`docs/kb/waves/2026-09-03/reports/datalog-vs-cypher/`. Do not modify anything
else in the repo, do not touch `.kb/nodes.jsonl`, do not install packages into
`tools/kb`. Read-only everywhere else.

## Who this is for

The repo owner. Assume they know nothing about either query model. They build
`kb`, an outliner knowledge base where **everything is a node** (a tag is a
node, a field is a node, a field's allowed values are nodes) stored as EAV-ish
JSONL and queried with DataScript datalog. They said:

> I think Cypher is pretty good because you literally can model everything with
> relationships — a field is just a relationship. Can you help me differentiate
> those, and guide how those work, leading to the crux of their differences?

Lead them from zero to the crux. Every claim must be backed by a runnable demo
or a cited primary source.

## Context you must read first

- `docs/kb/waves/2026-09-03/plan.md` — decisions D3, D4, D10 (why kb keeps
  DataScript for now, the hosted Tana-scale trajectory, the "one adapter later"
  plan). Your report feeds the query-IR design in
  `briefs/p1-persistence.md` Phase 2f.
- `docs/kb/waves/2026-09-03/reports/measurements.md` §7 — datoms/node, heap,
  and the path-query demo numbers already taken.
- `tools/kb/DESIGN.md` §data model + `tools/kb/src/foundation/query/datascript.ts`
  — how nodes become datoms (`:node/id`, `:node/text`, `:node/child`,
  `:node/mentions`, `:f/<fieldId>` attrs; schema is data-derived; refs are
  `cardinality/many`; dangling refs degrade to a string sentinel).
- `.kb/nodes.jsonl` (read-only) — the real graph, 231 nodes. Use it for demos.
- `.kb/queries/todos.edn` — a real stored query.

## Deliverables (all under `reports/datalog-vs-cypher/`)

1. `README.md` — the explainer. Structure it as a guided walk, roughly:
   1. **One dataset, two mental models.** Take ~6 real kb nodes (a tag node,
      a field node, two tagged nodes, one `[[mention]]`, one parent/child) and
      show them three ways: as kb JSONL, as EAV datoms (E A V triples), as a
      labelled property graph (nodes with labels+properties, typed edges). Make
      the reader see they are the *same facts*.
   2. **"A field is just a relationship."** Confirm it — and show where the
      two models put the *field's own identity*. In kb the field is a node
      (`:f/<fieldId>` attr *is* a node id); in LPG a property key is a string
      on the node and a relationship type is a string on the edge — neither is
      a first-class node unless you reify it. Show what reifying costs in
      Cypher and what it buys. This is the crux of kb's "everything is a node".
   3. **Reading data: pattern matching in both.** Same 6–8 questions, side by
      side, in DataScript EDN (runnable) and Cypher (text; runnable if you can
      get an engine — see below): find all todos; todos with status=doing;
      backlinks to X; nodes tagged with a tag that *extends* another tag
      (rule/inheritance); children in order; count per tag; pull a subtree.
   4. **Where datalog is stronger.** Recursive rules as reusable predicates
      (closure, ontology inheritance, "todo via any ancestor tag"), negation,
      joins on *any* attribute without declaring an index/edge, `pull`,
      schema-less growth, composability. Demo each.
   5. **Where Cypher is stronger.** Paths as values: `-[*1..3]->`,
      `shortestPath`, `nodes(p)`/`relationships(p)`, path length/weight, and
      planner support for deep traversals. Show the datalog attempt at each
      and exactly where it stops (endpoints only; bounded depth needs a rule
      body per depth or a counter; no path value). Reuse/extend the demo in
      `measurements.md` §7.
   6. **The crux, stated once.** Something like: EAV+datalog is a
      *fact-oriented* model — everything is a triple, relationships and
      attributes are the same kind of thing, and the query language is
      relational logic over facts; LPG+Cypher is a *structure-oriented*
      model — nodes and edges are different kinds of thing, edges can carry
      properties, and the query language is pattern matching over paths.
      Then say what that means for an "everything is a node" outliner: which
      model matches its philosophy, what it gives up, and what "path features
      later, via one adapter" would concretely require (edge properties?
      reified fields? a `path` IR clause?). Be honest; do not sell either.
   7. **Glossary** at the end (datom, EAV, entity id, lookup ref, rule, pull,
      LPG, label, relationship type, property, path, reification).

2. `demo-datascript.ts` — one Bun script, runnable with
   `cd tools/kb && bun ../../docs/kb/waves/2026-09-03/reports/datalog-vs-cypher/demo-datascript.ts`.
   It must import `buildQueryDb`/`query` from
   `./src/foundation/query/datascript.ts` **and `datascript` from the same
   package instance** — i.e. run from `tools/kb` so module resolution hits
   `tools/kb/node_modules`. (A script living elsewhere that imports its own
   `datascript` copy gets a *different module instance* and every query
   returns 0 rows; this bit us already.) Print each question, the EDN, the
   rows, and the ms. Cover every runnable claim in the README.

3. `demo-cypher.md` (or `demo-cypher.cypher` + notes) — the Cypher side.
   Prefer runnable: check whether a zero-install engine is reachable
   **without touching the repo**: e.g. `docker run memgraph/memgraph` or
   `neo4j` in a scratch dir, or a pure-JS/WASM Cypher engine if one is
   credible in 2026 (verify; do not guess). If you can run it, load the same
   6–8 nodes via `CREATE`, run the same questions, paste real output. If you
   cannot, say so plainly at the top and keep the Cypher as carefully checked
   text against the openCypher reference — mark every unverified line.

4. `SOURCES.md` — primary sources only (DataScript README/docs, Datomic query
   reference for datalog semantics, openCypher spec, Memgraph/Neo4j docs for
   path functions), with the specific section each claim leans on.

## Quality bar

- Owner is technical but new to both models; **no jargon before it is
  defined**. Short sentences. Tables for side-by-side. Every code block runs
  or is marked unverified.
- Do not restate the decisions in `plan.md`; link to them. Your job is the
  *understanding*, theirs is the decision.
- Keep the whole README under ~600 lines; depth goes in the demos.
- Finish with a 10-line "what I'd tell the owner" summary at the top of the
  README (write it last).

## Report

When done, append a `## Handoff` section to `README.md`: what ran vs what is
text-only, anything you could not verify, and open questions for the IR design.
