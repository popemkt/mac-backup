# `kb` — repo-native outliner datastore (design doc)

A Bun/TS tool living in this repo that persists an outliner graph as
git-friendly JSONL, exposes a datalog query layer (DataScript), and
materializes markdown from queries. One action registry drives CLI and MCP.

**What this actually is** (answering the "graph db?" question): yes — a tiny
graph database plus application features, which is exactly Tana's and Logseq's
architecture. Logseq *is* DataScript in memory (classic parses md → datoms; the
new DB version persists datoms in SQLite). Tana is a proprietary node graph
with supertags/fields/views as app features on top. We build the same shape,
minimal: DataScript = graph engine; our node/field/tag model = app layer.
Reactivity (TanstackDB-style live queries) is how Logseq's UI works —
`d/listen!` on transactions → re-run affected queries. Irrelevant for a
per-invocation CLI (fresh db each run); if we later add watch-mode or a server,
`d.listen` is the hook. Door left open, nothing built.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Name | **`kb`** | confirmed |
| Storage | Backend-agnostic `Store`; **JSONL backend v1** | exact round-trip, line-per-node git diffs. git-lfs rejected (stores blobs, doesn't make them mergeable); dolt-on-branch possible later as another backend |
| Query | **DataScript** in-memory, rebuilt per invocation | real datalog; Cozo persistent backends are binary |
| Surfaces | **CLI + MCP over one action registry** | action is the abstraction (harman pattern) |
| Runtime | **Bun**, no build step | the production `kb` tool (CLI, `kb ui` server, MCP) runs under Bun and may use Bun APIs (`Bun.serve`, `Bun.file`, …) where appropriate |
| Toolchain | **TypeScript 7 + Vite+ (`vp` 0.2.8)** | vp owns lint/check/fmt/UI test; authoritative typecheck is `tsc --noEmit` — see [Runtime/tooling boundary](#runtimetooling-boundary) |
| Model | **Everything is a node** — fields and tags included | Tana model; Logseq DB does the same (properties are first-class entities) |

## Runtime/tooling boundary

The backend runs on **Bun** in production; the toolchain around it is **Vite+
(`vp` 0.2.8) + TypeScript 7**. The two are deliberately separated:

- **Bun is the production runtime.** `bin/kb` is a bash shim
  (`#!/usr/bin/env bash`) that `exec`s Bun on `src/surface/cli.ts`; the
  `kb ui` server uses `Bun.serve`/`Bun.ServerWebSocket` as the listen/WS/`Bun.file`
  boundary while routing, assets, and the subscription hub are Effect programs;
  the store streams with
  `Bun.file`/`Bun.write`; `Bun.hash` powers change detection. These are
  appropriate Bun APIs and stay.
- **vp owns the tooling.** `tools/kb/package.json` scripts:
  - `typecheck` → `tsc --noEmit` (TS 7, zero-error gate; also enforced by the
    pre-commit hook when `tools/kb/` changes). This is the authoritative
    typecheck — not `vp check`.
  - `lint` → `vp lint` (oxlint)
  - `check` → `vp check --no-fmt` (**lint-only** here: `lint.options.typeCheck`
    is off in `tools/kb/vite.config.ts`. That was once recorded as
    "oxlint-tsgolint is not verified as a meaningful gate for this Bun/Effect
    tree" — **superseded**: type-aware lint is measured and turned on by `g2`
    (`briefs/g2-strict-stack.md`), because an Effect tree with `Effect.runFork`
    inside `setTimeout` and WS callbacks is exactly what `no-floating-promises`
    and `no-misused-promises` exist to police. `--no-fmt` skips format;
    `vp fmt` remains available for incremental adoption)
  - `test` → `bun test`.
- **Two test runners, and only two.** `bun test` runs the backend packages and
  the repo-shape harness, because those tests exercise Bun APIs (`Bun.serve`,
  `Bun.file`, store round-trips) that would need to exist under a node worker
  to run anywhere else. `vp test` (Vitest) runs `@kb/ui`, because component
  tests need Vitest mock-hoisting and happy-dom. Neither runner is a fallback
  for the other, and a third would be a second test stack wearing a disguise.
  Recursive `bun test` from `tools/kb` also discovers `ui/**/*.test.ts(x)`
  files — only the Vitest-only paths in `bunfig.toml` are ignored — so a full
  backend `bun test` still needs the ui deps installed.
- **Backend lint/check never enter `ui/`.** `tools/kb/vite.config.ts` sets
  `lint.ignorePatterns: ["ui/**", …]`. The browser app is its own Vite+
  package (`tools/kb/ui`) with separate install, `vp` config, and gates.
- TypeScript 7 removed `baseUrl`; the UI tsconfig uses relative `paths`, and
  the backend tsconfig scopes to backend sources (`src`, `tests`,
  `extensions-bundled`) — it never compiles `ui/`.
- **Minimal valid entrypoints.** Every way to start kb is a named script in a
  package manifest, complete enough that a fresh shell with no prior
  environment can run it. No raw `bun path/to/thing.ts` with a hand-built
  environment below that layer, and removing a way to start something is a
  deletion of its script, never a deprecation comment.

### Compiler strictness contract

One `tsconfig.base.json` owns strictness; every package extends it and declares
only its own delta (`include`, `paths`, `jsx`, `lib`). **This table is the
contract** — `g2`'s `tsconfig-contract` harness check parses it and fails when
the base config and this table disagree, so a flag is changed here first and in
the config second.

| flag | value | status |
|---|---|---|
| `strict` | `true` | on |
| `noUncheckedIndexedAccess` | `true` | on |
| `noImplicitOverride` | `true` | on |
| `noFallthroughCasesInSwitch` | `true` | on |
| `verbatimModuleSyntax` | `true` | on |
| `exactOptionalPropertyTypes` | `true` | on |
| `noUnusedLocals` | `true` | on |
| `noUnusedParameters` | `true` | on |
| `noImplicitReturns` | `true` | on |
| `allowUnreachableCode` | `false` | on |
| `allowUnusedLabels` | `false` | on |
| `noUncheckedSideEffectImports` | `true` | on |
| `erasableSyntaxOnly` | `true` | on |
| `forceConsistentCasingInFileNames` | `true` | on |
| `useUnknownInCatchVariables` | `true` | on |
| `skipLibCheck` | `true` | exception |
| `noPropertyAccessFromIndexSignature` | `false` | rejected (114 backend + 239 ui) |

The two rows that are not plain `on`:

- `skipLibCheck: true` is an **exception**, not a preference: three upstream
  packages do not typecheck under TS 7 today. The one `.d.ts` most worth
  checking is our own hand-written `datascript.d.ts`, so the harness
  typechecks that shim in isolation under `skipLibCheck: false` instead
  (`datascript-shim-typechecks`). Delete the exception when upstream is fixed.
- `noPropertyAccessFromIndexSignature` is **rejected** on measurement, not on
  taste: 114 backend and 239 ui sites, all of them index-signature reads that
  the flag would only re-spell. Re-open it with new numbers, not a new opinion.

`module`, `target`, `moduleResolution` and `paths` are deliberately **not** in
the base: they are per-package facts (the ui builds for the browser, the
backend runs under Bun) and a base that guesses them forces every package to
re-declare a delta it does not mean. The `@effect/tsgo` plugin is configured
alongside this contract for backend packages only, with
`ignoreEffectSuggestionsInTscExitCode: false` so its correctness diagnostics
fail `typecheck` rather than decorating it.

## Spec-first changes

This file is the spec; the code is one materialization of it. A change edits
the spec section first, in the same change and earlier in commit order, then
the code follows. If the section cannot be written, the code cannot be written:
vagueness in prose is the cheapest place to discover an under-specified
decision, and vagueness in code is the most expensive. When the implementation
wants something the spec does not authorize, that is a signal to revise the
spec — not a licence to expand intent quietly in the implementation.

When the spec must temporarily lag the code, the lag is written down first: a
`#gap` node and a `// GAP [[id]]` marker (see
[Drift markers and gaps](../../CLAUDE.md#drift-markers-and-gaps)). The goal is
not zero drift; the goal is visible, intentional drift.

## Testing doctrine

The long form of the evidence behind this section is
`docs/kb-waves/2026-09-03/reports/recon-draiver.md` §4; what follows is the
part that governs kb.

**Properties are design artifacts, not test volume.** A property states a
falsifiable domain claim, and falsifiability runs from the **rejecting** side:
an accept-everything round-trip is not a property. Three anti-patterns are
named so a reviewer can cite them:

| anti-pattern | shape | why it has no power |
|---|---|---|
| TAUTOLOGY | the oracle re-implements the function under test | passes for every implementation, including a wrong one |
| STRUCTURAL | asserts what the type system or `Schema` already guarantees | the negation is unrepresentable |
| quantifier theatre | `fc.constantFrom` over two or three values, or a filtered generator wearing a `forall` | claims coverage it does not have |

The keeper classes are metamorphic relations (idempotence, injectivity,
invariance, erasure — `store-roundtrip`, `order`, `mentions` are all of this
kind), fail-closed backstops, precedence, conservation/projection, and
cross-function agreement. Mutate one field and assert the rejection *names the
violated path*. Determinism is mandatory: no wall clock, no unseeded
randomness, fixed seed in CI, and a failure prints seed plus counterexample. A
pure function is not by itself a reason to write a property.

**Coverage is a signal, never a gate.** It may be reported; there is no
"fail below N%" check and there will not be one. Chasing a percentage
manufactures exactly the noise this doctrine forbids.

**The mutation score is advisory.** Stryker runs weekly over the pure core with
no `thresholds` block, and its own workflow header records that the score is
non-reproducible run to run. It is a sensor a human reads to find a missing
test; a non-deterministic merge blocker erodes trust in every other gate.

**Size is a signal; boundaries and branching are the gate (L1/L2/L3).**

- **L1 — structural, hard (`error`).** Cross-unit coupling: import cycles,
  layer direction, a unit reaching past another's public surface. Mechanical
  and non-negotiable.
- **L2 — within-unit sensors, two tiers.** *Branching* sensors (`complexity`,
  `max-depth`, `max-nested-callbacks`) are hard, because they measure shape
  directly. *Size* sensors (`max-lines`, `max-lines-per-function`,
  `max-params`) only ever `warn`: a legitimately large cohesive unit is real,
  and a length cap forces exactly the bad split a reviewer would have to
  reverse. A long but flat body of well-named steps is good code.
- **L3 — cohesion, advisory.** "Is this one responsibility?" is a review
  judgement, never a merge blocker.

A unit may be long; it may not be tangled.

## Domain typing — Effect `Schema`

Once a domain value is parsed, narrowing on its discriminator hands back the
right field shape with no further checks: no `!`, no `as`, no field that
"exists for one variant but not another".

- **No optional-where-discriminated.** If a field is sometimes present and the
  rule for when it appears is encodable, do not write `field?: T` — lift the
  rule into a discriminator. The live violation is `KbNode.order?`: a
  fractional sibling rank marked "optional during migration", absent from
  `KbNodeSchema` altogether, surviving the round trip only because decode runs
  with `onExcessProperty: "preserve"`. The one field the outline depends on for
  ordering is invisible to the schema, and any backend with a real column or a
  stricter decode drops it silently. Track 2 fixes it
  (`briefs/p1-persistence.md`); this section records it until then.
- **Discriminators are literals**, never `Schema.String`. `PropValue.t`,
  `ActionReceipt.status`, `ServerMessage.op`, `MemberReason.kind` and
  `DomainError.code` are the model's discriminators and each is a literal
  union; a `switch` over one is exhaustive by construction.
- **One canonical schema, never re-declared inline.** A shared shape is
  declared once and referenced. An inline copy that drifts by one field is the
  classic way to drop data on a round trip.
- **Parse `unknown` at every boundary.** A boundary's parameter is `unknown`
  and its first act is a decode; that is validation, not a cast. Finding
  yourself writing `node.props[id]!` means the schema is too loose — tighten
  the schema, do not bypass the type.

## Data model — everything is a node

```ts
type NodeId = string; // ULID, or "sys.*" for seeded system nodes

interface KbNode {
  id: NodeId;
  text: string;
  props: Record<NodeId, PropValue[]>;  // key = FIELD NODE id, not a string
  children: NodeId[];                   // ordered outline
  createdAt: string;
  updatedAt: string;
}

type PropValue =
  | { t: "str" | "num" | "bool" | "date"; v: string | number | boolean }
  | { t: "ref"; v: NodeId };
```

- **Fields are nodes.** A field is just a node typed `sys.field` (e.g. node
  `01J..X` text "status"). `props` keys are field-node ids, so fields are
  reusable anywhere, renameable in one place, and can carry their own props
  (description, allowed values) later. Attaching any field to any node is
  legal — tags only *template* fields, never restrict them (Tana semantics).
- **Tags (supertags) are nodes** typed `sys.tag`, holding a `sys.f.fields`
  prop listing field-node refs they template. Applying a tag = adding a
  `sys.f.type` ref prop. Multiple tags per node allowed.
- **Ref targets are declared on the field node.** A ref field may carry
  `sys.f.targetTag` (sugar — union of the listed tags' instances) or
  `sys.f.targetQuery` (general form — parameter-free EDN whose rows name node
  ids). `targetQuery` **wins** over `targetTag`: the tag is one shape of the
  query, so honouring both would answer one question twice. Resolution lives in
  `src/foundation/field-type.ts` (`allowedRefIdsOf`, EDN runner injected) and is
  shared by CLI, MCP and the browser through the `@kb/field-type` alias — same
  posture as the ontology resolver.
- **Hiding `sys.*` is a display rule, never a resolution rule.** Resolution
  surfaces — ref-target constraints, ontology membership, datalog, validity
  checks — read the kind slot (`typeRefsOf`, i.e. `sys.f.type`) and return
  everything it names, seeded ids included: `sys.f.fieldType` legitimately
  targets six `sys.ft.*` options and `sys.f.onto.include` legitimately targets
  every supertag. Display surfaces then decide what to *show*: an unconstrained
  ref picker hides infrastructure (`fuzzyNodeCandidates` in `ui/src/lib/refs`),
  and the outline's `#tag` badge list omits the kind refs so a tag's own page
  shows no "#tag" chip. Those two lists are not interchangeable — reading the
  badge list back as membership reports every supertag as untagged, which is
  what once left `sys.f.onto.include` with an empty allowed set. Write
  protection is a third, separate concern (`isSysPrefixed` + `--force`);
  referencing a `sys.*` node as a *value* is not a write to it.
- **System nodes**, seeded on init, are ordinary nodes with reserved ids:
  `sys.field` (the type of fields), `sys.tag` (the type of tags),
  `sys.f.type` (the "type/tag" field), `sys.f.fields` (tag→templated fields).
  That's the whole special set; everything else is user space.
- **Name resolution**: CLI/actions accept field/tag *names*; resolver does a
  unique-text lookup among `sys.field`/`sys.tag` nodes (error on ambiguity,
  `--create` to mint). Resolution is dynamic at load — at our scale (\<\<100k
  nodes) caching is premature; revisit only if load profiling says so.
- **Refs / `:node/mentions` (the reference relationship, carrier-independent).**
  Two things carry a reference in this model, and `:node/mentions` is emitted
  from **both**:
  1. a wiki-link in node `text` — `[[node-id|label]]` or bare `[[node-id]]`;
  2. a `{t:"ref"}` **prop value** — a typed field pointing at a node.

  At datom build time each distinct target of either kind becomes one
  `:node/mentions` ref datom on the source (deduplicated per source→target,
  since the attribute is cardinality-many) — same shape as Logseq
  `:block/refs` (parse-at-transact). The UI renders inactive text refs as
  accent links (click = zoom, ⌘/Ctrl-click = jump); the relationship itself is
  queryable, not UI-only. Example — nodes that reference a target:

  ```
  [:find ?from ?text
   :where [?e :node/mentions ?m]
          [?m :node/id "n.root-a"]
          [?e :node/id ?from]
          [?e :node/text ?text]]
  ```

  (`kb backlinks <id>` is the shorthand; `src/foundation/query/queries.ts`
  `backlinksQuery` is the single owner of that EDN, and the browser reads it
  through the `@kb/queries` alias rather than keeping a copy.)

  **Why both carriers, one attribute.** A ref prop *is* a relationship. When
  only text tokens produced the datom, `kb backlinks` and the UI's References
  section silently missed every prop-borne reference — a status value did not
  know its tasks, a tag did not know its instances, and a contextual reference
  did not appear on the node it referenced. The alternative (ask twice and
  union at each call site) is the second `if` on one distinction that Rule 1
  forbids, so the fix belongs in the relation, not in the question. The carrier
  distinction survives exactly where it is a genuine lens: the graph's
  `mention` / `child` / `ref-prop` edge kinds label provenance, and each is
  therefore read from its own carrier (`collectEdges` in `ui/src/lib/graph-lens.ts`
  scans text, children and props separately and never queries `:node/mentions`,
  which would double every prop edge).

  Optional Logseq-style `:node/path-refs` (ancestor mentions) is backlog —
  add only when a real query needs hierarchy-scoped reach.
- **Contextual references** (Tana "contextual content") are the node kind built
  on that relation: an ordinary node tagged `#ref` (`sys.tag.ref`) whose
  `sys.f.ref.target` ref prop names a target. It renders the target's *current*
  text verbatim (so the target's markdown still renders); its own children are
  content local to that location and stay on the
  reference, so the original shows them only through References/backlinks — a
  new node *kind*, not a new node *type*, exactly like `#query`. Anatomy, the
  rendering rule and the deliberate deviations from Tana are in
  [DESIGN-UI.md → Contextual references](./DESIGN-UI.md#contextual-references-i12).
  Creating one needs no new action:

  ```bash
  kb action-invoke '{"id":"node.add","input":{"text":"","parent":"<host>",
    "tags":["sys.tag.ref"],
    "props":[{"field":"sys.f.ref.target","value":{"t":"ref","v":"<target>"}}]}}'
  ```
- Datom mapping: `[id :node/text v]`, `[id :node/child child]` (+order),
  `[id :f/<fieldId> v]` with ref values as entity refs → native datalog joins
  and graph traversal.

## Storage (horizontal)

```ts
interface Store {
  load(): Promise<KbNode[]>;
  commit(tx: { upserts: KbNode[]; deletes: NodeId[] }): Promise<void>;
}
```

- **JsonlStore v1**: `.kb/nodes.jsonl`, one canonical-JSON node per line,
  sorted by id, sorted keys → stable bytes, mergeable diffs.
- **Performance is a stated requirement**, and what the code does today is:
  read the whole file into one string, split on newlines, decode each line
  through `Schema`; single-pass datom build; durable whole-file replace
  (below). Load is **not** a streaming line parse — this doc claimed one for a
  while and the code never had it. The streaming parse is a target, not a
  description, and the wave that owns it is `briefs/p1-persistence.md`.
  `tests/benchmark.test.ts` holds the standing bar: a 50k-node fixture loads,
  builds and queries well under a second. `.bak` / `nodes.jsonl.*.tmp` are
  gitignored — only the live `nodes.jsonl` is committed. The transient
  `nodes.jsonl.lock` is *not* yet gitignored (known gap).
- **Write hardening** (r4 Stage-0 — on-disk format unchanged), two modules
  under `src/foundation/storage/`:
  - `write-lock.ts` — an exclusive `.kb/nodes.jsonl.lock` carrying the holder
    pid wraps the *whole* commit via `Effect.acquireRelease` inside
    `Effect.scoped`, so reload → merge → replace is one critical section and
    concurrent CLI / MCP / `kb ui` writers cannot silently clobber each other
    (previously last-writer-wins). Contention spins on `Effect.sleep`
    (25ms, `MAX_WAIT_MS` 15s — never a loop-blocking sleep); a lock whose
    recorded pid is dead is stolen, and only exhausting the ceiling fails,
    with a `conflict` error naming the holder pid.
  - `durable-replace.ts` — write the candidate to a tmp fd + `fsync`, copy the
    live file to `nodes.jsonl.bak` (+fsync), `rename` tmp → live, best-effort
    parent-directory fsync. Ordering-safe; **not** crash-injection tested
    (no `F_FULLFSYNC`, no revision/CAS).
- **Load is all-or-nothing**: a malformed or schema-invalid line fails the load
  with a line-numbered error and returns no nodes; load never rewrites the file
  (same fail-closed posture as the pre-Schema `JSON.parse` loader). Unknown own
  JSON properties on otherwise-valid nodes are preserved across decode so a later
  commit cannot silently drop them.
- Backend-agnostic by construction — operations/query/surfaces see only
  `Store` + `KbNode`. The candidate second backends are **not** an open field
  any more: `briefs/p1-persistence.md` §0 is the canonical record of what was
  measured and rejected (Logseq's own fork — opaque Transit blobs, and their
  answer to git is "export markdown" — plus Cozo, Kuzu, Mentat, Datahike/XTDB,
  the server-backed graph databases, and the CRDT stores). What survives is a
  `bun:sqlite` **index**: derived, gitignored, fingerprinted against the JSONL,
  deletable at any time, and never authoritative — the type must say so.
- No WAL, no leases — repo scale. The lock above is advisory, filesystem-local
  and process-scoped; it serializes writers but does not make a *reader's*
  snapshot binding. Conditional writes (an `expect` precondition carrying graph
  identity / node hash, returning the existing `conflict` receipt) are designed
  in `docs/kb-waves/2026-08-23/reports/r8-zerolang.md` §1 and **parked** — no
  action input accepts `expect` today.

## Query layer (horizontal)

- `datascript` npm. Load → datoms → `conn` → query.
- `kb query '<edn datalog>'` for raw power; pull API via `kb get <id> --depth N`.
- Query failures are typed at the action boundary: errors thrown by the
  datascript engine on the caller's EDN become `DatalogError`
  (→ `invalid_input`); defects in our own glue (normalization / result
  revival) stay plain `Error` (→ `internal`) so internal bugs are never
  hidden behind "invalid datalog".
- **Saved queries are data, not code** (portability): `.kb/queries/*.edn`
  files, run via `kb run <name>` or the first-class `graph.run` action.
  The tool stays generic; repo-specific
  queries travel with the repo's data dir. Any repo adopting `kb` brings its
  own `.kb/queries/`. Shell-script wrappers optional on top, zero baked-in.
- Built-in shorthands limited to structural ones: `kb backlinks <id>`,
  `kb children <id>`, `kb search <text>` — `kb search` delegates to the
  first-class `graph.search` action (case-insensitive substring over node
  text), so the substring policy lives in the action, not the CLI.

## Ontologies — a lens over the graph

An **ontology** is an ordinary node tagged `#ontology` that names a subset of
the graph. It is a new node *kind*, not a new node *type*: nothing in the data
model changes, and membership bookkeeping lives on the ontology, never on the
member — a node that never joins one carries zero ontology props. Full design
(including the parts deliberately left out) is
`docs/kb-waves/2026-08-23/reports/r5-ontology.md`.

Six seeded fields carry the definition, all templated by the `#ontology` tag:

| Field | Type | Means |
|---|---|---|
| `sys.f.onto.include` | ref (→ `sys.tag`), multi | tags whose instances are members |
| `sys.f.onto.member` | ref, multi | explicit pins |
| `sys.f.onto.exclude` | ref, multi | vetoed nodes — absolute |
| `sys.f.onto.extends` | ref (→ `#ontology` via `sys.f.targetQuery`), multi | parent ontologies whose members are inherited |
| `sys.f.onto.query` | text | parameter-free EDN datalog; first column = node id |
| `sys.f.onto.closure` | text: `none` (default) \| `descendants` | structural pull of members' subtrees |

**Membership algebra — core is union + veto:**

```
members(O) =  ⋃ members(P)  for P ∈ O.extends      -- inheritance
           ∪  { n | ∃t ∈ O.include . n tagged t }  -- supertag sets
           ∪  O.member                             -- explicit pins
           ∪  ids(run(O.query))                    -- query-defined
           ⊕  closure(O.closure)                   -- structural pull
           ∖  O.exclude                            -- absolute veto
           ∖  { O } ∪ extends-ancestors(O)         -- definitions never members
```

Precedence is the whole rule a human has to remember: **union everything, then
subtract**. `exclude` is applied last and beats tag-, pin-, query-, extends-
and closure-derived membership, which is what makes "remove this from my
ontology" always work. Set algebra *over* ontologies (`intersect` / `subtract`,
so "Infrastructure ∩ Open work" would itself be a node) is specified in r5 §1.2
and is out of core — the resolver signature leaves them as extra passes rather
than a rewrite.

**Nothing graph-shaped throws.** `extends` is a DAG by intent and cycle-safe by
implementation: DFS with a `visiting` set, back-edges ignored *and reported*,
depth capped at 32 (`DEFAULT_MAX_DEPTH`). Cycles, malformed EDN, unknown refs,
a missing query runner, and the soft size cap (`DEFAULT_WARN_ABOVE` = 5000
members) all surface as `warnings` on the resolution instead of failing it —
a broken definition must never make a page unopenable. Same posture as
`buildTreeForest` in the graph lens.

**One resolver, three surfaces.** `src/foundation/ontology.ts` is pure and
isomorphic — no Node/Bun API, no `datascript` import; the EDN runner is
*injected*. CLI and MCP pass `foundation/query`, the browser passes its own
`ds/query`, both reaching the same module through the `@kb/ontology` alias, so
there is no fork (contrast `ds/datoms.ts`). Resolution is deterministic
(input node order, then prop order) and carries per-member provenance —
`reasons: MemberReason[]` with `kind: "member" | "tag" | "query" | "extends" |
"closure"` and an optional `via` — which is what the Members list renders.

**Surface.** `ontology.members` (read) is the only registry action the feature
adds: everything mutating is already expressible as `node.add` / `node.update`,
and the resolver is the one thing not expressible as a single datalog query.
CLI sugar:

```bash
kb ontology list                        # #ontology nodes
kb ontology members <id> --reasons      # members + provenance + excluded + warnings

# defining one is plain node.update — but the onto.* ref fields need --type ref:
# a bare `kb set` writes {t:"str"} and the resolver only counts {t:"ref"}.
kb set <onto> onto.include <tagId>  --type ref
kb set <onto> onto.member  <nodeId> --type ref
kb set <onto> onto.exclude <nodeId> --type ref
```

So the UI's scope is *exactly* reachable through data — the standing rule in
INSPIRATIONS.md ("anything the UI can do must be reachable through data").

**Scoped reading mode** is the UI consumption of the same resolver and is
specified in DESIGN-UI.md. The one invariant that belongs here: scope is a
**projection over the wire snapshot, not a sandbox** — the query db stays built
over the full graph, so backlinks, `#query` nodes, and WS subscriptions keep
honest reach while the outline/graph/search render members only.

Parked by design (r5 §2.9, none of it in core): an ontology's *schema*
vocabulary (which fields members carry) and *relation* vocabulary (which
ref-fields count as internal edges), inference, auto-classification, validation
enforcement, tag inheritance, and auto-admission of nodes created inside a
scope.

## Action registry

Harman-lite (zod) + Effect-native handlers for owned actions:

- `ActionDefinition { id, title, description, mode: "read"|"apply", inputSchema, outputSchema, effect? }` — JSON Schemas via `z.toJSONSchema`, never hand-written. Optional `effect` is the Effect-native handler seam for built-ins / bundled extensions.
- `ActionReceipt` = `succeeded | failed` discriminated union, typed failure codes, never throws across boundary.
- `registryFor(root)` builds a handler table per kb root (cached for the
  process); `manifest(root)` + `invoke(ctx, invocation)` / `invokeReceiptEffect` dispatch through it.
- Dispatch prefers `effect` and composes it under `Effect.scoped` (finalizers / interrupt). Legacy Promise `handler`s (third-party `.kb/extensions`) are the only path lifted via `tryPromise`.
- Skipped from harman (YAGNI): profiles, pagination cursors, idempotency
  replay, A2A surfaces. Contracts leave room; Fiber interrupt covers cancellation for native handlers.

### Core boundary & extensions

Core ships mechanism only: store (JSONL), datalog (DataScript), the action
registry, subscription hub, render backbone (view specs + templates), and the
CLI/MCP/UI surfaces. Policy — what markdown to write where, repo-specific
output of any kind — lives in **extensions**:

- An extension is a TS module in `.kb/extensions/` (repo-local = trusted)
  whose default export is an array of harman-style actions: an
  `ActionDefinition` plus either Effect `effect(input)` (preferred) or a
  legacy Promise `handler(ctx, input)` (see `src/extensions.ts`).
- The registry discovers them at build and namespaces ids as
  `ext.<file>.<action>`. A failing module or malformed action warns and is
  skipped — extension errors never crash core. `kb ext list` shows what
  loaded (and what didn't).
- `tools/kb/extensions-bundled/docs.ts` / `canvas.ts` are Effect-native
  bundled examples (`effect` handlers using `KbCtx` / `FileSystem` /
  `KbStore` Layers). Docs owns `ext.docs.materialize` / `ext.docs.check`,
  with legacy aliases `docs.materialize` / `docs.check`. Core keeps only the
  render mechanism the extension calls into (`src/operations/docs/`).
- Extensions are loaded once per process; changing one requires restarting
  long-lived surfaces (`kb ui`, `kb mcp`).
- **Extension SDK:** external `.kb/extensions/*.ts` authors get types from
  the running binary — `kb ext sdk --write` emits `.kb/sdk.d.ts` (ambient
  module `kb-ext-sdk`), then `import type { ExtensionAction } from
  "kb-ext-sdk"`. Types are generated from `src/ext-sdk/surface.ts` and
  embedded in the CLI bundle; `bun scripts/gen-ext-sdk.ts` refreshes the
  committed string (freshness-tested). Prefer Promise `handler`s; schemas
  may be zod, Standard Schema v1, or a bare `{ parse }`. Helper siblings
  should `export default []` so discovery stays quiet.

## Operations (verticals)

| Action | Mode | Does |
|---|---|---|
| `node.add` | apply | create (text, props by field name/id, parent, position, tags) |
| `node.update` | apply | edit text / set-unset props / move / delete |
| `node.get` | read | pull subtree to depth N |
| `field.define` / `tag.define` | apply | mint field/tag nodes (sugar over node.add) |
| `graph.query` | read | raw datalog → JSON rows |
| `graph.run` | read | execute saved query from `.kb/queries/` |
| `graph.search` | read | text/prop filter convenience |
| `ontology.members` | read | resolve an `#ontology` node's membership, with provenance ([Ontologies](#ontologies--a-lens-over-the-graph)) |
| `asset.upload` | apply | write opaque bytes to `.kb/assets/<ulid>.<ext>`; returns the `assets/…` markdown path |
| `render.view` | read | render a saved view (`.kb/views/<name>.json`) to html or md |
| `render.views` | read | list saved view names available to `render.view` |
| `ext.docs.materialize` (alias `docs.materialize`) | apply | run view specs → write md (bundled extension) |
| `ext.docs.check` (alias `docs.check`) | read | materialize to memory, diff vs disk (bundled extension) |
| `ext.canvas.tx.apply` | apply | apply a JSON Canvas transaction to a `#canvas` node (bundled extension) |

## Materialization

- View specs `.kb/views/*.json`: `{ output, query | savedQuery, template }`;
  templates = named TS functions (rows → md), no template-lang dep.
- **v1 ships exactly one view: `docs/kb/todos.md`** (nodes tagged `todo`,
  grouped by status). Curation of more views comes later, driven by tags.
- Generated files carry `<!-- generated by kb; do not edit -->`.
- **`docs.check` in pre-commit from day 1**: `.githooks/pre-commit` gains a
  `kb check` step in the same milestone that ships materialize (M4).

## Surfaces

- **CLI** (`commander`, `#!/usr/bin/env bun`): human commands + `kb action-invoke <json>`; `--json` everywhere. Internal command orchestration is Effect (`resolveRootEffect` → `openKbEffect` → `runPlanEffect` / `invokeReceiptEffect`) with an `Effect.runPromise` + exit-code boundary at each Commander surface action (not a claim that the whole process has a single runPromise). Commander itself stays the argv contract.
- **MCP** (`kb mcp`, `@modelcontextprotocol/sdk` stdio): loop manifest → one
  tool per action → Effect handler (`callToolEffect` / resource Effects via `reloadEffect` + `invokeReceiptEffect`); `readOnlyHint` from mode. SDK request handlers remain Promise-returning; CallTool maps Fail/Die to `isError`, resource Fail/Die to JSON-RPC `-32603`.
- **Agent onboarding**: CLAUDE.md/AGENTS.md section — node model, field/tag
  conventions, 5 example invocations.

### Remaining Effect surface boundaries

- `surface/ui/**` HTTP routing, assets, and SubscriptionHub are Effect programs;
  Bun.serve remains the listen/WS/`Bun.file` boundary (see Runtime/tooling
  boundary and DESIGN-UI.md). `/api/action` composes `invokeReceiptEffect`
  directly (no nested `invoke` Promise).
- Repository-owned / core / bundled action handlers are Effect-native end to
  end (`effect` + Layers). Third-party `.kb/extensions` may still export
  Promise `handler`s; those alone use `tryPromise` inside `invokeEffect`.
- Registry discovery still uses dynamic `import()` of extension modules
  (Promise at the load boundary). Standard Schema `validate` may return a
  Promise and is lifted once at parse time.
- Surface tips (`CLI` Commander actions, MCP SDK handlers, `Bun.serve`) still
  call `Effect.runPromise` / `runPromiseExit` at the process edge — not inside
  action handlers.
- No `@effect/cli` adoption (Commander preserved by design).

## Repo integration

- Code `tools/kb/` (repo tooling, not system config). Committed lockfile.
- Data `.kb/` (nodes.jsonl, queries/, views/). Generated docs `docs/kb/`.
- Shell alias `kb` in `modules/common/home-manager/shell.nix`.
- MCP registration via `ai-agents` stack.
- JSONL = intentional repo data → committed, not Mackup.
- Seed: migrate current `TODO.md` items into tagged todo nodes (M5).

## Milestones

- **M1 Core**: model, system-node seed, JsonlStore (+50k benchmark), DataScript adapter, contracts, registry, `node.*`, `graph.query`. bun tests.
- **M2 CLI**: commander wiring, name resolver UX, saved queries (`kb run`), shorthands.
- **M3 MCP**: stdio server, manifest-driven registration.
- **M4 Materialize**: view specs, todos.md view, `docs.check` + pre-commit hook wiring.
- **M5 Integration**: alias, ai-agents MCP wiring, CLAUDE.md section, TODO.md migration.

## Execution: orca orchestration, cursor:claude ≈ 3:1

- M1 first (everything depends on contracts + store). After M1 merges,
  **M2/M3/M4 run fully parallel** in separate orca worktrees — they touch
  disjoint dirs (surface/cli, surface/mcp, operations/docs-*). M5 last on main.
- Worker assignment: **cursor agents** implement M1, M2, M3 (3 workers);
  **claude agent** takes M4 (materialize + hook touches `.githooks`, closest
  to repo conventions). ≈3:1.
- I orchestrate via orca-cli: dispatch, wait on worker_done, run
  `cavecrew-reviewer` on each worktree diff, **fix findings myself**, merge
  sequentially (M1 → parallel trio → M5).

