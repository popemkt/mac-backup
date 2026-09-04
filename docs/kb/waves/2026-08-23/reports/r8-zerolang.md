# R8 — Zerolang: what kb should steal from a graph-first compiler

**Decision:** steal the *guardrails around semantic writes*, not Zero's
artifact ownership model.  `kb` is already graph-first at the data layer and
already exposes an action registry to agents.  The highest-value gap is that a
write can be based on a stale read.  Add small, explicit conditional-write
preconditions and a projection identity/verification contract; keep
`docs/kb/*.md` generated and keep arbitrary projection caching deferred.

Research was time-boxed to 20 minutes on 2026-08-23.  I read Zero's public
documentation and cloned its public source to `/tmp/zerolang-r8` at
`afcc72da649fe4d4c670ac1489c2197d37436051` (read-only scratch).  This report
does not propose making changes in this wave.

## Zerolang, accurately

Zero is an experimental, graph-native programming language.  Its primary
program database is `zero.graph`; the normal package compile path loads that
graph rather than parsing source text.  The graph stores compiler-level
facts—declarations, types, calls, blocks, imports, capabilities, source-map
facts, stable node IDs, and graph identity.  The `.0` files are canonical,
human-readable *projections* of that store.  The public repository contains
both (the `.graph` files are binary data; `.0` files are text).

That makes this its normal agent loop:

```text
zero query / inspect        -> obtain symbols, node IDs, facts, graph hash
zero patch --expect-graph-hash --op ...
                            -> compiler validates and atomically accepts/rejects
zero check/test/run          -> prove the requested behaviour
zero export                  -> optional human review text
```

`zero patch` is not a text edit encoded in a command.  It addresses semantic
structure (for example a function body or a literal-expression node) and can
carry graph-hash, node-hash, and expected-field-value preconditions.  Shape,
ordering, type, and repository-metadata validation happen before the store is
written.  A stale or invalid patch therefore fails with a fact the agent can
re-query, rather than leaving a broken intermediate file for a later compiler
pass to diagnose.

### What “projecting the files themselves” means

It does **not** mean an agent writes `.0` and some watcher treats the text as
the authoritative program.  It means Zero can emit a stable, readable source
projection of the graph so a person can review it, use familiar diagnostic
spans, or deliberately take a text-edit escape hatch.

The ownership and reconciliation rules are explicit:

| Situation | Zero's rule |
| --- | --- |
| Agent authoring | Query and patch `zero.graph`; do not normally edit `.0`. |
| Human review | `zero export`, then review the `.0` projection. |
| Intentional human text edit | `zero import` reconstructs/validates the graph, then `zero check` and `zero export`. |
| CI/no-write integrity check | `zero verify-projection`. |
| Graph and projection both moved | Fail (`RGP006`); offer import/export repair, never silently choose one. |

Every graph-store write records a content hash of the source projection.  Zero
uses those hashes—not mtimes—to classify a projection as clean, source-newer,
store-newer, missing, or diverged across clones and staged worktrees.  Its
normal commands may reconcile source-newer text; `ZERO_STALE=fail` opts into
strict failure.  This is the important losslessness claim: the projection
boundary is explicit, reconstructable, and verified; it is not a best-effort
code generator.

### Incrementality and caches

Zero's graph identity also feeds compiler artifact/cache keys.  The source
shows cache paths for graph/MIR and emitted objects and an early cached-run
path.  This is sensible for a compiler whose graph avoids re-parsing and whose
build artefacts are expensive.  It is not evidence that every graph projection
should be cached: cache correctness depends on including graph identity,
target/profile, compiler version, and projection state in the key.

## kb's actual projection seam today

`kb` has a similar topology but different ownership.  Its authority is
`.kb/nodes.jsonl`: canonical JSONL nodes, sorted by ID and key, loaded
all-or-nothing and atomically rewritten.  `.kb/views/*.json` is declarative
view configuration.  Markdown, HTML, browser rows, and MCP resources are
projections of those two inputs, not alternate databases.

| Surface | Current contract and implementation |
| --- | --- |
| Render backbone | `src/render/index.ts` accepts a named view and format.  It loads a view, runs its Datalog query, uses the named deterministic TS template, returns the exact generated Markdown or a self-contained minimal HTML shell.  `render.view` and `render.views` expose the same capability through the action registry. |
| View shape | `src/operations/docs/views.ts` validates strict JSON `{ output, query \| savedQuery, template }`: exactly one query source and a repo-relative output with no traversal.  `src/operations/docs/index.ts` resolves saved queries, executes them against `qdb`, and prepends the generated-file header.  Templates are named TS functions over rows plus a node/field resolver; today `todos` groups todo nodes by status. |
| Materialized docs | The bundled `ext.docs.materialize` creates parent directories and writes each view output.  `ext.docs.check` renders to memory and reports `clean`, `stale`, or `missing` by byte-comparing disk with the expected bytes.  Legacy `docs.*` aliases keep the pre-commit gate intact.  `docs/kb/todos.md` is the live example, driven by `.kb/views/todos.json`. |
| MCP view surface | `src/surface/mcp.ts` registers `render_view` and a `ui://kb/view/<name>` HTML resource for every saved view.  Both reload KB state, then use the same named-render effect—not a parallel renderer. |
| UI wire protocol | `src/surface/protocol.ts` specifies full graph snapshots, action calls/receipts, saved queries, and WS `subscribe`/`unsubscribe`, `watch-tx`, `tx`, and `rows` messages.  `rev` is a process-local monotonic missed-update detector, not a durable graph identity. |
| Subscriptions | `surface/ui/session.ts` maintains the server-side DataScript graph.  On a changed node set it uses a content hash to suppress duplicate watcher/action events, broadcasts node deltas to `watch-tx` clients, reruns each subscribed query, and sends rows only when their hash changes.  It is correct/coarse v1 invalidation, not dependency-aware incremental computation. |
| Query nodes | A query node is an ordinary node tagged `sys.tag.query` carrying EDN in `sys.f.query` and an optional `sys.f.query.limit`.  The UI derives result node references from the first node-ID-looking result column.  When expanded it subscribes over WS; on collapse/unmount it unsubscribes.  Without an open socket it evaluates locally against client DataScript.  Saved `.kb/queries/*.edn` entries also become virtual `sys.query.*` nodes under `sys.queries` for the UI only and are never persisted. |
| Extension seam | `.kb/extensions/*.ts` default-export action definitions; the loader namespaces them as `ext.<file>.<action>`.  Per-file/action load errors are collected and skipped rather than crashing core.  Bundled extensions use Effect-native handlers; third parties may use the Promise handler seam.  Docs materialization is deliberately policy above core, even though it calls core rendering machinery. |

Two details matter for the comparison.  First, `kb` already makes semantic
operations first-class: `node.add`, `node.update`, field/tag definitions,
`graph.query`, saved-query runs, view rendering, and extension actions all
share typed schemas and `ActionReceipt`s across CLI, MCP, and UI.  This is a
small direct-to-the-database/compiler-like protocol already.

Second, it currently has no request-level `expect`/graph-version precondition
on `node.update` or its other mutations.  The store is atomic, but an agent
can read a node, another surface can change it, and the agent can then apply a
valid write based on stale semantics.  `updatedAt` is queryable, but it is not
enforced as a conditional write guard.

## Comparison and verdicts

| Zero idea | kb analogue | Delta | Verdict |
| --- | --- | --- | --- |
| Graph/program database as source of truth | `.kb/nodes.jsonl` is already canonical intentional data; DataScript is rebuilt from it. | kb's graph is intentionally small, JSONL/git-friendly, and does not need a binary compiler store. | **Already adopted.** Do not replace JSONL with Zero's compiler-oriented graph format. |
| Agents talk directly to semantic machinery | Action registry, CLI/MCP/API actions, Datalog, typed receipts, and the UI protocol. | Actions lack read-version and field/node expectations, so they can express an edit but not the snapshot it assumes. | **Steal the preconditions, not a new protocol.** |
| Human-readable projection | Generated docs, rendered HTML resources, query-node result views. | These are intentionally lossy/display-specific (Markdown text rendering and simple HTML), unlike a language source projection. | **Keep derived.** Do not promise import/export round trips for docs or HTML. |
| Artifacts become source of truth | Views are source configuration; docs are byte-checked materializations. | Treating generated docs or MCP HTML as editable source would create two ownership paths and violate the core/extension split. | **Reject.** Improve provenance/verification only. |
| Content-hash cache/incrementality | Hub hashes graph state and query rows; UI also has a revision/resync protocol. | Docs and named views rerun query/template work; no stable projection identity or dependency-keyed cache. | **Selective.** First expose an identity; cache only after a measured bottleneck. |
| Lossless round-trip contract | Canonical JSONL preserves unknown own properties and validates on load; docs check exact generated bytes. | No formal projection-to-source import exists or should exist for generic views. | **Adopt at the model/action boundary only.** JSONL/action receipt correctness should be strict; display projections should be deterministic and verifiable, not reversible. |

The simplicity rule is decisive here.  Zero needs graph/source reconciliation
because it has two useful authoring surfaces.  kb's generated docs deliberately
have one: node/view data is edited, docs are regenerated.  Copying Zero's
import/export/reconcile machinery would add a competing source of truth where
the present design has none.

## Ranked adoptable ideas

### 1. Conditional semantic writes (`expect`) — high value / medium effort

**Proposed future wave: R9, Agent transaction guards.**

Add optional optimistic preconditions to mutating action inputs, without
inventing a patch language.  A minimal shared shape could be:

```ts
expect?: {
  graph?: "sha256:...";             // canonical persisted-node-set identity
  node?: { id: NodeId; updatedAt?: string; hash?: string };
  prop?: { node: NodeId; field: NodeId; values?: PropValue[] };
}
```

The registry would reload, derive the canonical graph hash, check expectations
immediately before `persistEffect`, and return the existing `conflict` receipt
with current values/identity on failure.  Start with `node.update`, delete,
move, and field/tag changes; add it to extension apply actions only when they
mutate graph data.  `--check-only`/dry-run can validate a proposed action
without committing.

This borrows Zero's strongest practical property: a semantic write states what
it saw and atomically fails if that fact ceased to be true.  It strengthens the
ground-up model, uses the registry that already exists, and does not turn kb
into a compiler or make agents compose unbounded graph patches.

### 2. Projection identity and a `verify` receipt — medium-high value / small effort

**Proposed future wave: R10, Projection contracts.**

Make every named render return a deterministic identity alongside content, for
example `sha256(canonical({ nodesHash, viewSpecBytes, resolvedSavedQueryBytes,
templateVersion, format }))`.  Have `docs.check` report that identity for
clean/stale/missing views and add a read-only `render.verify` action that can
verify a declared view/output pair without rewriting it.

Keep the identity out of the generated Markdown header initially: byte compare
already detects edits, and a dynamic header would cause avoidable churn.  The
identity is a receipt/provenance fact for agents, CI, MCP consumers, and later
caching.  It answers “which exact graph/view/template produced this?” without
pretending the materialization is editable source.

This is the useful part of Zero's projection-state hash: content-based,
clone-stable inspection and an explicit no-write verification operation.

### 3. Narrow, transparent render cache only behind measurement — medium value / medium effort

**Proposed future wave: R10 follow-up, only if profiling justifies it.**

After R10 exists, cache the *pure result* of named rendering by its projection
identity in a gitignored runtime cache.  A hit may skip query/template work;
a miss must produce identical bytes.  Cache entries need no invalidation
algorithm because their key includes all inputs.  Do not cache action receipts
or treat a cache hit as proof that an on-disk document is current—`docs.check`
still compares expected bytes.

This is deliberately ranked below preconditions and provenance.  kb's current
subscription hub already avoids duplicate broadcasts and unchanged row pushes;
design documentation puts a 50k-node re-query around 20ms for tens of
subscriptions.  A generic dependency tracker, incremental template engine, or
cache database would add machinery before an observed problem.  Measure
materialization and `render.view` latency/allocations first, with a stated
threshold and hit-rate target.

## Explicit non-adoptions

- **Do not make `docs/kb/*.md`, MCP HTML, or query-node output editable
  sources.** `docs.check` and the generated header are correctly one-way.
  Adding import/reconcile would create ambiguity, erase policy ownership in
  extensions, and make review output semantically dangerous.
- **Do not add a general agent patch DSL.** kb's typed action registry is the
  small, discoverable compiler boundary.  Conditional inputs and dry-run are
  enough until a repeated real operation cannot be expressed as an action.
- **Do not promise lossless Markdown/HTML round trips.** Promise exact JSONL
  preservation and schema/action validation; require deterministic projections
  and exact verification; keep presentation formats presentation-only.
- **Do not copy Zero's binary store/compiler cache stack.** It is coherent for
  a programming-language compiler.  kb's readable canonical JSONL is an
  intentional Git/merge property and is the right substrate at this scale.

## Sequencing

1. R9 adds canonical graph identity plus conditional writes and conflict tests
   across CLI, MCP, and HTTP action surfaces.
2. R10 adds render provenance/verification by reusing that identity; it must
   preserve present docs-materialize byte output unless explicitly versioned.
3. Only profile-driven R10 follow-up adds a gitignored pure render cache.
   Extension-provided new materializations remain extension policy and use the
   same receipt/verification path rather than gaining a special runtime.

That sequence preserves kb's central invariant: **one graph, many derived
lenses**.  Zero's lesson is not “make every lens authoritative”; it is “make
the authoritative semantic write precise, checked, and explicit about stale
state.”

## Sources

- Zero source, README and compiler implementation (examined at the pinned
  commit above): <https://github.com/vercel-labs/zerolang/tree/afcc72da649fe4d4c670ac1489c2197d37436051>
- Zero, [Graph architecture](https://zerolang.ai/concepts/graph-architecture)
  — graph facts, checked patches, human review boundary.
- Zero, [Projections](https://zerolang.ai/concepts/projections) — explicit
  export/import/verify/status, content-hash divergence rules.
- Zero, [Semantic vs text](https://zerolang.ai/concepts/semantic-vs-text) and
  [Compile path](https://zerolang.ai/concepts/compile-path) — graph-first
  compiler input and agent-facing semantics.
- Zero, [CLI reference](https://zerolang.ai/cli) — query, patch, validation,
  and projection command contract.
- Local kb evidence: `tools/kb/src/render/`,
  `tools/kb/src/operations/docs/`, `tools/kb/src/surface/protocol.ts`,
  `tools/kb/src/surface/{mcp.ts,ui/session.ts,ui/saved-queries.ts}`,
  `tools/kb/ui/src/{lib/query-node.ts,components/outline/query-results.tsx}`,
  `tools/kb/src/extensions.ts`, and `tools/kb/extensions-bundled/docs.ts`.
