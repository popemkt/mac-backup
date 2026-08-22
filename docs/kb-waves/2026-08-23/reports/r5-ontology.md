# R5 — Ontology: ambitious design + core-only implementation spec

Worker: claude (worktree `kb-r5-ontology`). Research/design only — no
implementation, no commits. Gate: `./intent/gate.sh session claude` →
`SOFT_MISSING: shellcheck actionlint nvfetcher` (soft, non-blocking).

Owner's intent (verbatim): *"ontology is sort of a supertag sets/tree/graph —
when you use an ontology, you only see nodes of such ontology and how they're
connected. Probably ontology is a new node with a new editing experience but
idk."*

**Answer to "idk"**: yes — a new node *kind*, not a new node *type*. An
ontology is an ordinary node tagged `#ontology`, carrying `sys.f.onto.*`
props. It needs a new *editing experience* (an ontology page) and a new
*reading mode* (scope). Nothing in the model changes.

The three words in the owner's phrase map cleanly onto three mechanisms that
already exist or are cheap:

| Owner's word | Mechanism |
|---|---|
| supertag **sets** | membership = union of tag-instance sets + explicit members + a query |
| **tree** | `extends` between ontologies (superset/subset), cycle-safe |
| **graph** | the scoped subgraph, rendered through the existing lens pipeline |

---

## 0. Verified facts that constrain the design

These were probed live against this worktree (`bun tools/kb/src/surface/cli.ts`),
not assumed. They change what "core" can be.

1. **Client-side datalog takes no inputs.** `ui/src/ds/query.ts:runQuery(qdb,
   edn)` has no `inputs` parameter, and `ClientMessage.subscribe`
   (`src/surface/protocol.ts:56`) carries `{op, id, query}` only — no inputs.
   Every client-side and subscription query in kb is therefore
   **parameter-free EDN**, with ids templated into the string (see
   `ui/src/lib/schema-zoom.ts` doing exactly that: `[?t :node/id "${tagId}"]`).
   ⇒ An ontology's membership cannot be a parameterised query; it is either a
   templated string or computed in TS.
2. **Recursive datalog rules DO work — but only awkwardly.** `graph.query`
   accepts `inputs`; passing rules as an EDN *string* with **quoted attribute
   names** resolves recursion correctly:

   ```jsonc
   // verified: returns the transitive descendants of the root
   {"id":"graph.query","input":{
     "query":"[:find ?id :in $ % ?root :where [?r :node/id ?root] (desc ?r ?n) [?n :node/id ?id]]",
     "inputs":["[[(desc ?a ?b) [?a \":node/child\" ?b]] [(desc ?a ?b) [?a \":node/child\" ?m] (desc ?m ?b)]]",
               "01KZGDP5HQK39HHKXSFX0G56K1"]}}
   ```

   Unquoted `:node/child` inside the rule fails with `Cannot compare :node/id
   to :node/child` (datoms store attrs as strings); rules passed as nested
   JSON arrays fail with `Unknown rule 'desc`.
   ⇒ Transitive closure is *expressible* but not *ergonomic*, and it is
   unavailable on the client at all. **Core computes closure in TS.**
3. **`WireNode` and `KbNode` are structurally identical** (`protocol.ts:26`
   vs `foundation/model.ts:11`), and the UI already imports pure backend
   modules through aliases: `@kb/protocol` → `../src/surface/protocol.ts`,
   `@kb/canvas` → `../src/canvas/doc.ts` (`ui/tsconfig.json`,
   `ui/vite.config.ts`).
   ⇒ **One resolver implementation, shared by CLI and UI**, via a new
   `@kb/ontology` alias. No copy-paste fork like `ds/datoms.ts`.
4. **`extractLensGraph` already resolves its node set from a single set**
   (`ui/src/lib/graph-lens.ts:resolveNodeSet`), so restricting the graph to an
   ontology is a ~4-line additive change, not a new renderer.
5. **The outline is projected through one function**,
   `wireToOutlineMap(wireNodes, expandedIds)` (`ui/src/lib/graph-view.ts:110`),
   called from four places in `outline.store.ts` (`hydrateFromWire`,
   `applyTx`, `restoreSnapshot`, `refreshFromWire`). Scoping the outline =
   filtering the array passed to those four calls. Search
   (`store.search` → `searchNodes(nodes)`) then scopes **for free**, because it
   iterates the projected `NodeMap`.

---

## PART 1 — Ambitious full-scope design

Unbounded by tonight. This is the target the core must not paint itself out of.

### 1.1 What an ontology *is*

An ontology is a **typed lens over the graph**: a named, queryable, editable
node that answers four questions at once.

```
   ┌─ ONTOLOGY NODE  ⬡ "Infrastructure" ──────────────────────────────┐
   │                                                                  │
   │  1. WHO is in it?      membership algebra  → a set of node ids    │
   │  2. WHAT do they say?  schema vocabulary   → fields members carry │
   │  3. HOW do they link?  relation vocabulary → which ref-fields are │
   │                                              edges *inside* here  │
   │  4. HOW does it look?  presentation        → renderer/color/      │
   │                                              cluster (lens props) │
   └──────────────────────────────────────────────────────────────────┘
```

Only (1) and (4) are core tonight. (2) and (3) are what make an ontology more
than a saved filter, and both have a designated home in the model already.

### 1.2 Membership algebra (full scope)

```
members(O) =
      ⋃  members(P)                    for P ∈ O.extends      -- inheritance
   ∪  { n | ∃t ∈ O.include . n tagged t }                      -- supertag sets
   ∪  O.member                                                 -- explicit pins
   ∪  ids(run(O.query))                                        -- query-defined
   ∩  ( ⋂ members(Q) for Q ∈ O.intersect )     [full scope only]
   ∖  ⋃ members(R)   for R ∈ O.subtract        [full scope only]
   ∖  O.exclude                                                -- absolute veto
   ⊕  closure(O.closure)                                       -- structural pull
   ∖  { O }                                                    -- never itself
```

Full scope adds `intersect` / `subtract` — i.e. an ontology *expression*, so
"Infrastructure ∩ Open work" is itself a node. Core ships union + veto only;
the resolver signature is written so `intersect`/`subtract` are extra passes,
not a rewrite.

**Precedence rule (the "what if both exist" answer):**
union everything, then subtract. `exclude` is absolute and wins over tag-,
query-, extends-, and closure-derived membership. This is the only rule a
human has to remember, and it is the rule that makes "remove this from my
ontology" always work.

**Cycles:** `extends` is a DAG by intent, cycle-safe by implementation. DFS
with a `visiting` set; a back-edge is *ignored and reported as a warning*, not
an error — same posture as `buildTreeForest` in `graph-lens.ts`. Depth capped
at 32. Rationale: a broken definition must never make the UI unopenable.

### 1.3 Tag trees, in and out

kb has **no tag inheritance today** — the R1 Tana capture
(`.research/kb-refine/tana/report.md` §2.3) shows Tana's supertag config panel
but does not evidence its inheritance mechanics, and DESIGN.md lists tag
inheritance as an open investigation. The ontology design must therefore
*anticipate* tag trees without depending on them.

- **In:** when `sys.f.tag.extends` lands, membership expansion gets exactly one
  new hook: `expandIncludeTags(includeIds) → includeIds ∪ subtagClosure`.
  Everything downstream is unchanged. The core resolver is written with that
  function present and returning identity.
- **Out:** an ontology *projects* a tag tree. Its `include` list plus the
  `extends` chain form a two-level hierarchy today (ontology → tags) and an
  n-level one once tags nest. The ontology page's Schema tab renders that as
  the tag tree.
- **Ontology-of-ontology is the tree we have now.** `extends` gives
  superset/subset relations between ontologies without touching the tag model
  at all. `A extends B` means "every member of B is a member of A" — A is the
  superset. (Reads backwards from OOP `extends`; the alternative naming
  `sys.f.onto.includes-ontology` is uglier. Documented, not clever.)

### 1.4 The scoped experience (full scope)

Entering an ontology filters the *whole app*, not one view.

```
  /o/<id>            ontology outline — members only, their internal structure
  /o/<id>/graph      ontology subgraph — member nodes, internal edges only
  /o/<id>/canvas     canvases whose cards are all members
  /o/<id>/schema     the vocabulary page (tags, fields, coverage)
```

Composition rules with existing navigation:

| Surface | Behaviour under scope |
|---|---|
| **Zoom** | Scope is *outer*, zoom is *inner*. Entering a scope resets `rootNodeId` to the scope root. Zoom then works normally within the member set. |
| **Breadcrumbs** | Ontology chip occupies position 0: `⬡ Infrastructure / Networking / Tailscale`. Clicking the chip returns to the scope root; clicking past it exits scope. |
| **Leaving via a link** | Following a `[[ref]]` to a non-member: full scope offers an inline choice — *Follow (leave ontology)* / *Add to ontology and stay*. Core does the first with a toast. |
| **Search** | Scoped automatically (it iterates the projected `NodeMap`). |
| **⌘K palette** | Stays **global** — it is the deliberate escape hatch out of a scope. Full scope re-ranks members first and shows a `⬡` badge on non-members. |
| **Perspectives** | Orthogonal. The ontology decides *which nodes*; the perspective decides *renderer / color-by / cluster-by / edge-kinds*. Both pickers coexist in the graph header. |
| **New nodes** | Full scope: a node created inside a scope auto-joins per the ontology's *admission rule* (apply its primary include tag, or append to `member`). This is the single highest-value non-core feature — without it, working inside a scope leaks. |
| **Backlinks** | Full scope: scoped, with "N references outside this ontology" as an expandable footer. |

### 1.5 Editing experience (full scope)

**Zooming an ontology node opens an ontology page**, not a normal outline row.
Four tabs; the first is core.

```
 ⬡ Infrastructure                                    412 members ▾   [Exit]
 ┌─────────┬────────┬───────────┬──────┐
 │ Members │ Schema │ Relations │ View │
 └─────────┴────────┴───────────┴──────┘

 MEMBERS
   include   #service ×   #host ×   [+ tag]
   extends   ⬡ Networking ×                    [+ ontology]
   query     [:find ?id :where …]               [edit]
   ──────────────────────────────────────────────────────────────
   ⬤ tailscaled                    via #service          [pin] [×]
   ⬤ popemkt-work                  via #host             [pin] [×]
   ⬤ Cloudflare tunnel notes       pinned                       [×]
   ⬤ WireGuard keys                via ⬡ Networking → #secret   [×]
   ◌ Old VPN doc                   excluded              [restore]
```

**Provenance is the load-bearing feature.** A hybrid membership model
(tags + query + explicit + inherited) is unusable unless every row can answer
"why am I here?". The resolver produces the reasons during resolution — it is
nearly free at resolve time and expensive to retrofit. It is therefore **in
core**, even though the tabs around it are not.

- **Add** a member: `[pin]` promotes a derived member to explicit (survives
  the tag being removed), or drag any node onto the ontology.
- **Remove** a member: `[×]` writes to `exclude`. If the member was
  tag-derived, the UI says so — "still tagged `#service`; excluded here only" —
  because the alternative (silently untagging a node from a lens) is the kind
  of surprise that destroys trust in a KB.
- **From the node side**: a regular node's panel grows an *Ontologies* chip
  row next to its tag chips, listing the ontologies it belongs to with its
  provenance. "Join" offers both paths explicitly — *apply `#service`* (joins
  this and every ontology including that tag) vs *pin to this ontology only*.
  **Membership bookkeeping never lives on the member node** — see §2.3.

Schema / Relations / View tabs (non-core): union of fields templated by the
include tags with per-field coverage ("`owner` set on 38/412"); selection of
which ref-fields count as internal edges; renderer/color/cluster defaults
stored in the existing `sys.f.lens.*` fields on the ontology node itself.

### 1.6 Graph integration (full scope)

No new renderer, ever. The existing pipeline is
`datalog → {nodes, edges} → renderer` (locked by
`.research/kb-refine/graphviz/report.md`), and an ontology is just a different
way of producing the node set:

```
  ontology  ──resolve──►  Set<nodeId>  ──►  extractLensGraph(db, wire,
                                              perspective, {restrictTo})
                                                 │
                                                 └─► sigma / tree / cluster / 3d
```

Full scope refines *edges*, not the renderer: only ref-fields in the
ontology's relation vocabulary become edges, so an ontology graph shows
`depends-on` / `part-of` structure instead of generic mentions. Default
`cluster-by` = the include tag, which makes a multi-tag ontology legible at a
glance.

### 1.7 Non-goals — named and parked

Not "later"; **deliberately never in core**, and only on evidence of need:

- **Inference / reasoning.** No subsumption, no transitive property inference,
  no OWL semantics. `extends` is set union, computed eagerly. If reasoning is
  ever wanted it belongs in an extension that materialises derived facts as
  ordinary nodes.
- **Auto-classification.** No LLM/heuristic "this node probably belongs to
  Infrastructure". An agent can do this through `node.update` like any other
  writer; the core never guesses membership.
- **Validation enforcement.** An ontology may *describe* expected fields; it
  must never *block a write*. Coverage is reported, never enforced. (A KB that
  refuses your note because a field is missing is a KB you stop using.)
- **RDF / OWL / SKOS import-export.** Interchange is a genuine future ask, but
  it is an extension concern (`ext.ontology.export`), not core mechanism.
- **Ontology versioning / diffing / merge.** git already versions
  `nodes.jsonl`.

---

## PART 2 — Core implementation spec (overnight, I2)

Scope discipline: the core delivers exactly the owner's sentence — *enter an
ontology, see only its nodes and how they connect* — plus the membership
algebra needed to make that non-trivial, plus provenance so the algebra is
legible. Everything else is Part 1.

### 2.1 Seed additions (`src/foundation/model.ts`, `src/foundation/seed.ts`)

Additive only. `ensureSystemSeed` already merges missing ids without touching
existing nodes, so a `.kb/nodes.jsonl` that has never seen an ontology gains
these rows and nothing else.

```ts
// SYSTEM_IDS additions
ontologyTag:        "sys.tag.ontology",
ontoIncludeField:   "sys.f.onto.include",   // ref, multi  → tag nodes
ontoMemberField:    "sys.f.onto.member",    // ref, multi  → any node
ontoExcludeField:   "sys.f.onto.exclude",   // ref, multi  → any node
ontoExtendsField:   "sys.f.onto.extends",   // ref, multi  → ontology nodes
ontoQueryField:     "sys.f.onto.query",     // str, single → parameter-free EDN
ontoClosureField:   "sys.f.onto.closure",   // str, single → "none" | "descendants"
cmdNewOntology:     "sys.cmd.new-ontology",
cmdEnterOntology:   "sys.cmd.enter-ontology",
cmdExitOntology:    "sys.cmd.exit-ontology",
```

Seeded shapes, mirroring the `#graph-perspective` block in `seed.ts`:

```ts
const ontoIncludeField = mk(SYSTEM_IDS.ontoIncludeField, "onto.include", {
  ...fieldType,
  [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
  [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
});
// … member / exclude / extends likewise (fieldType "ref"),
//    query as "text", closure as "text"

const ontologyTag = mk(SYSTEM_IDS.ontologyTag, "ontology", {
  [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
  [SYSTEM_IDS.fieldsField]: [
    { t: "ref", v: SYSTEM_IDS.ontoIncludeField },
    { t: "ref", v: SYSTEM_IDS.ontoMemberField },
    { t: "ref", v: SYSTEM_IDS.ontoExcludeField },
    { t: "ref", v: SYSTEM_IDS.ontoExtendsField },
    { t: "ref", v: SYSTEM_IDS.ontoQueryField },
    { t: "ref", v: SYSTEM_IDS.ontoClosureField },
  ],
});
```

`ontoExtendsField` gets `sys.f.targetQuery` (not `targetTag`) so the ref
picker offers only `#ontology` nodes:

```clojure
[:find ?id :where [?n :f/sys.f.type ?t] [?t :node/id "sys.tag.ontology"] [?n :node/id ?id]]
```

**No default ontology is seeded.** The `lens.all-mentions` precedent exists
because a graph page with zero perspectives is broken; an ontology list with
zero entries is a legitimate empty state.

**Instance node shape** — an ordinary ULID node, not `sys.*`, so the
write-guard does not lock it:

```jsonc
{
  "id": "01KZR0ONTOLOGY0000000001",
  "text": "Infrastructure",
  "props": {
    "sys.f.type":          [{"t":"ref","v":"sys.tag.ontology"}],
    "sys.f.onto.include":  [{"t":"ref","v":"01KZ…SERVICE"},
                            {"t":"ref","v":"01KZ…HOST"}],
    "sys.f.onto.extends":  [{"t":"ref","v":"01KZR0ONTOLOGY0000000002"}],
    "sys.f.onto.member":   [{"t":"ref","v":"01KZ…CFNOTES"}],
    "sys.f.onto.exclude":  [{"t":"ref","v":"01KZ…OLDVPN"}],
    "sys.f.onto.closure":  [{"t":"str","v":"none"}]
  },
  "children": [], "createdAt": "…", "updatedAt": "…"
}
```

Datoms produced by the existing builder (no builder change — every
`sys.f.onto.*` ref prop automatically registers as a `:db.type/ref` /
`:db.cardinality/many` attr, `datascript.ts:nodesToDatoms`):

```
[e ":node/id"            "01KZR0ONTOLOGY0000000001"]
[e ":node/text"          "Infrastructure"]
[e ":f/sys.f.type"       <eid sys.tag.ontology>]     ; ref
[e ":f/sys.f.onto.include" <eid 01KZ…SERVICE>]       ; ref, many
[e ":f/sys.f.onto.include" <eid 01KZ…HOST>]
[e ":f/sys.f.onto.extends" <eid …0002>]
[e ":f/sys.f.onto.member"  <eid 01KZ…CFNOTES>]
[e ":f/sys.f.onto.exclude" <eid 01KZ…OLDVPN>]
[e ":f/sys.f.onto.closure" "none"]
```

Listing ontologies is therefore plain datalog, no new mechanism:

```clojure
[:find ?id ?text
 :where [?n :f/sys.f.type ?t] [?t :node/id "sys.tag.ontology"]
        [?n :node/id ?id] [?n :node/text ?text]]
```

### 2.2 The resolver — `src/foundation/ontology.ts` (new, pure, isomorphic)

Single implementation shared by CLI, MCP, UI. No Node/Bun API, no direct
datascript import — the EDN runner is injected, which is what keeps it usable
from both `foundation/query` and `ui/src/ds/query`.

```ts
export type MemberReasonKind =
  | "member" | "tag" | "query" | "extends" | "closure";

export interface MemberReason {
  kind: MemberReasonKind;
  /** tag id, parent ontology id, or the ancestor that pulled it in. */
  via?: NodeId;
}

export interface OntologyResolution {
  ontologyId: NodeId;
  members: Set<NodeId>;
  /** Why each member is a member — drives the Members list. */
  reasons: Map<NodeId, MemberReason[]>;
  /** Ids explicitly vetoed (rendered as "excluded", restorable). */
  excluded: Set<NodeId>;
  /** Non-fatal: extends-cycle, bad EDN, unknown ref, depth cap, size cap. */
  warnings: string[];
}

export interface ResolveOptions {
  /** Parameter-free EDN → rows. Injected: CLI passes foundation/query,
   *  UI passes ds/query. Absent ⇒ sys.f.onto.query is skipped + warned. */
  runQuery?: (edn: string) => unknown[][];
  /** Recursion guard for extends. Default 32. */
  maxDepth?: number;
  /** Warn (not fail) above this many members. Default 5000. */
  warnAbove?: number;
}

export function isOntologyNode(n: NodeLike): boolean;
export function listOntologyNodes(nodes: NodeLike[]): NodeLike[];
export function resolveOntology(
  nodes: NodeLike[],
  ontologyId: NodeId,
  opts?: ResolveOptions,
): OntologyResolution;
```

`NodeLike = Pick<KbNode, "id" | "text" | "props" | "children">` so `WireNode`
and `KbNode` both satisfy it structurally.

Resolution order (implements §1.2 minus intersect/subtract):

1. **extends** — DFS over `sys.f.onto.extends`, `visiting` set; back-edge →
   skip + `warnings.push("extends cycle: A → B → A")`. Depth > `maxDepth` →
   skip + warn. Parent members inherit reason `{kind:"extends", via:parentId}`.
2. **include tags** — for each tag id, collect nodes whose `sys.f.type` refs
   contain it. Single pass over `nodes`, no datalog needed. Reason
   `{kind:"tag", via:tagId}`. (This is the hook §1.3 extends when tag trees land.)
3. **explicit members** — `sys.f.onto.member` refs that exist. Unknown id →
   warn, skip. Reason `{kind:"member"}`.
4. **query** — if `sys.f.onto.query` is present and `runQuery` was supplied:
   run it, take the first column value per row that names a known node (same
   convention as `idsFromQueryRows` / `resultNodeIds`). Throw → warn, contribute
   nothing. Reason `{kind:"query"}`.
5. **closure** — `"descendants"` walks `children[]` from every member found so
   far (cycle-safe, visited set), reason `{kind:"closure", via:ancestorId}`.
   `"none"` (default) does nothing.
6. **exclude** — subtract `sys.f.onto.exclude` from `members`, record in
   `excluded`. **Applied last; wins over everything.**
7. **self** — the ontology node is never its own member. Parent ontologies
   reached via `extends` are likewise not members (they are definitions, not
   content).

Determinism: iteration follows the input `nodes` order and the prop order on
the ontology node; `members` is a `Set` but every consumer sorts. Two runs over
the same JSONL produce identical output — required for the tests and for
`docs.check`-style diffing later.

**Stated design limit (flag for r4-perf):** explicit membership lives as a
multi-valued prop on *one* node, so an ontology with 5 000 pins is one enormous
JSONL line. Explicit members are the escape hatch (tens); bulk membership comes
from tags and queries. The resolver warns above `warnAbove` (5 000) rather than
failing, and the ontology page shows the count.

### 2.3 Why membership lives on the ontology, not the member

The one non-obvious modelling decision, and it is what satisfies the brief's
migration requirement.

- A node that has never heard of ontologies carries **zero** ontology props.
  Its bytes in `nodes.jsonl` are unchanged. Deleting every ontology node
  removes the feature completely and leaves the graph identical.
- Tag-derived membership is the exception and is *already* one-sided in the
  right direction: it lives on the member, as the tag it already had.
- Cost: "which ontologies is this node in?" is a scan over ontology nodes
  (there will be dozens, not thousands) plus a tag lookup. Cheap, and it is
  the rarer query.

### 2.4 New operations

**Registry (backend) — exactly one new action.** Everything mutating is
already expressible as `node.add` / `node.update`; the resolver is the one
thing not expressible as a single datalog query, so it needs a surface.

| Action | Mode | Input | Output |
|---|---|---|---|
| `ontology.members` | read | `{ id: string, reasons?: boolean }` | `{ id, members: string[], reasons?: Record<id, MemberReason[]>, excluded: string[], warnings: string[] }` |

Failure codes: `not_found` (no such node), `invalid_input` (node exists but is
not `#ontology`-tagged). Never throws across the boundary — malformed EDN and
extends cycles surface as `warnings`, never as `failed`.

CLI sugar (`src/surface/cli.ts`, mirroring the `tag` / `field` sub-commands):

```bash
kb ontology list                       # datalog over #ontology, --json
kb ontology members <id> [--reasons]   # ontology.members
```

This keeps the rule from INSPIRATIONS.md intact: **anything the UI does is
reachable through data.** The UI's scope is exactly `kb ontology members <id>`.

**`ui/src/actions/plan.ts` — planners.** All are thin wrappers over the
existing `planSetProp` / `planUnsetProp`, exactly as `planAddTag` /
`planRemoveTag` are (`plan.ts:354`), so they inherit the optimistic-tx and
receipt plumbing untouched.

| Planner | Semantics |
|---|---|
| `planDefineOntology(name, newId)` | mint node + `#ontology` tag (mirrors `planNewQueryNode`); returns `focusId` for rename-on-create |
| `planOntologyAddInclude(nodes, ontoId, tagId)` | append ref to `sys.f.onto.include` |
| `planOntologyRemoveInclude(nodes, ontoId, tagId)` | unset that ref value |
| `planOntologyAddMember(nodes, ontoId, nodeId)` | append ref to `sys.f.onto.member` ("pin") |
| `planOntologyRemoveMember(nodes, ontoId, nodeId)` | unset that ref value |
| `planOntologyExclude(nodes, ontoId, nodeId)` | append ref to `sys.f.onto.exclude`; also removes a matching `member` ref in the same plan so pin+veto can't contradict |
| `planOntologyUnexclude(nodes, ontoId, nodeId)` | unset the exclude ref |
| `planOntologyAddExtends(nodes, ontoId, parentId)` | append ref to `sys.f.onto.extends`; **refuses** (returns `null`) if it would close a cycle — cheap pre-check on the client, resolver still cycle-safe on the server |
| `planOntologyRemoveExtends(nodes, ontoId, parentId)` | unset the ref |
| `planOntologySetQuery(nodes, ontoId, edn)` | single-valued str: unset old, set new |
| `planOntologySetClosure(nodes, ontoId, mode)` | single-valued str: `"none"` \| `"descendants"` |

`ui/src/actions/mutations.ts` exposes each as a `mutations.*` method with the
existing `guardSysWrite` + `applyPlan` treatment.

### 2.5 Scope mechanics (the "filtered universe")

One new pure helper plus one store field. This is the whole feature.

```ts
// ui/src/lib/ontology-scope.ts
export function scopedWireNodes(
  wireNodes: WireNode[],
  members: Set<string>,
  ontologyId: string,
): WireNode[];
```

For each member it returns a **clone with `children` filtered to members
only**, so a member's non-member children vanish rather than dangling. The
ontology node itself is included (it is the scope root header) but is not a
member. Non-members are dropped entirely.

`ui/src/stores/outline.store.ts` gains:

```ts
ontologyId: string | null;
ontologyMembers: Set<string> | null;   // resolved once per (rev, ontologyId)
setOntologyScope: (id: string | null) => void;
```

and the four existing `wireToOutlineMap(...)` call sites take
`this.ontologyId ? scopedWireNodes(wire, members, id) : wire`. `queryDb` stays
built over the **full** wire set — backlinks, `#query` nodes, and WS
subscriptions keep global reach and honest results. That asymmetry is
deliberate and documented: *scope is a projection, not a sandbox.* Scoping the
datalog engine is Part 1.

Consequences that fall out for free:
- `store.search` scopes (iterates the projected map).
- `getVisibleInstances` / keyboard nav / breadcrumbs scope.
- `applyTx` already resets `rootNodeId` to `homeRootId` when the root vanishes;
  when a scope is entered, `homeRootId` becomes the ontology's scope root, so
  an exit path always exists.

Graph reuse — a 4-line additive change, no new renderer:

```ts
// ui/src/lib/graph-lens.ts
export interface ExtractLensOptions {
  includeSystemNodes?: boolean;
  restrictTo?: Set<string>;      // NEW — intersected in resolveNodeSet()
}
```

### 2.6 UI surface list (file-level placement)

New files (the bulk of the work — chosen to minimise churn per the I2 note in
`plan.md`):

| File | Owns |
|---|---|
| `tools/kb/src/foundation/ontology.ts` | resolver (§2.2) |
| `tools/kb/ui/src/lib/ontology-scope.ts` | `scopedWireNodes`, memo per `(rev, ontologyId)` |
| `tools/kb/ui/src/components/ontology/ontology-page.tsx` | zoomed ontology node: header, include/extends/query editors, Members list with provenance |
| `tools/kb/ui/src/components/ontology/ontology-picker.tsx` | scope selector — copy the anatomy of `graph/perspective-picker.tsx` verbatim (popover, 13px, `aria-haspopup="listbox"`) |
| `tools/kb/ui/src/components/ontology/ontology-scope-bar.tsx` | persistent scope chip: `⬡ Name · 412 members · Exit` |
| `tools/kb/ui/src/components/ontology/member-row.tsx` | one member + provenance label + pin/exclude buttons |
| `tools/kb/tests/ontology.test.ts` | backend suite |
| `tools/kb/ui/src/lib/ontology-scope.test.ts`, `components/ontology/*.test.tsx` | UI suite |

Edits to existing files (all additive; **coordination points — list in the
handoff note**):

| File | Change |
|---|---|
| `src/foundation/model.ts` | `SYSTEM_IDS` additions |
| `src/foundation/seed.ts` | seed the tag + 6 fields + 3 commands |
| `src/operations/index.ts` | `ontologyMembersDef` + effect handler |
| `src/surface/cli.ts` | `kb ontology list|members` |
| `src/surface/map.ts` | plan mapping for the new command |
| `ui/tsconfig.json`, `ui/vite.config.ts` | `@kb/ontology` alias → `../src/foundation/ontology.ts` |
| `ui/src/lib/types.ts` | mirror the new `SYSTEM_IDS` entries |
| `ui/src/lib/router.ts` | `{name:"ontology", id, view:"outline"\|"graph"}` for `/o/<id>` and `/o/<id>/graph` |
| `ui/src/components/App.tsx` | route → `OntologyPage` / scoped outline |
| `ui/src/stores/outline.store.ts` | `ontologyId`, `ontologyMembers`, `setOntologyScope`, 4 call-site swaps |
| `ui/src/actions/plan.ts` + `mutations.ts` | the 11 planners |
| `ui/src/lib/graph-lens.ts` | `restrictTo` option |
| `ui/src/components/graph/graph-page.tsx` | accept `ontologyId`, pass `restrictTo` |
| `ui/src/components/sidebar/sidebar-nav.ts` + `sidebar.tsx` | `listOntologyNavItems` + an **Ontologies** section (mirrors the perspectives section) |
| `ui/src/lib/bullet-mode.ts` | `"ontology"` bullet kind (⬡), between `canvas` and `query` in the priority chain |
| `ui/src/lib/palette-index.ts` / `run-command.ts` | wire the 3 new `sys.command` nodes |

**Scope is in the URL, not just in memory** (`/o/<id>`), so a scope is
linkable, restorable on reload, and survives the back button. This is the one
place worth spending route surface on.

### 2.7 Test plan — what gets automated first

Ordered by what would hurt most if wrong. Backend under `bun test`, UI under
`vp test` (per the runtime split in DESIGN.md).

**Backend — `tools/kb/tests/ontology.test.ts`**

1. `resolveOntology` with one include tag returns exactly that tag's instances,
   and never the ontology node itself.
2. `exclude` beats `include`, `member`, `query`, and `extends` — one test per
   source, asserting the id lands in `excluded`, not `members`.
3. `extends` unions parent members; grandparent chain resolves; parent
   ontologies are not themselves members.
4. **`extends` cycle A→B→A terminates**, emits a warning, and still returns
   the correct union. *(Highest-value test in the suite: this is the failure
   mode that hangs the UI.)*
5. Depth cap: an 40-deep `extends` chain warns and stops at 32.
6. `sys.f.onto.query` — well-formed EDN contributes its ids; malformed EDN
   produces a warning and zero contribution, never a throw; absent `runQuery`
   warns and skips.
7. `closure: "descendants"` pulls non-member subtrees in; `"none"` (default)
   does not; a `children` cycle terminates.
8. Provenance: every member has ≥1 reason; a tag-derived member's reason names
   the tag; a doubly-derived member carries both reasons.
9. **Migration**: load a fixture `nodes.jsonl` containing no ontology nodes →
   `ensureSystemSeed` → commit → every pre-existing line is **byte-identical**
   and only the new `sys.*` lines are added. (Directly enforces the brief's
   "TODO content preserved" hard requirement.)
10. `ontology.members` receipt: success shape; `not_found` for a missing id;
    `invalid_input` for an untagged node; warnings surface in the payload
    rather than failing the receipt.

**UI — `vp test`**

11. `scopedWireNodes` — non-members dropped; a member's non-member children
    removed from `children[]` (no dangling ids in the outline map).
12. Store: `setOntologyScope(id)` ⇒ `getVisibleNodes() ⊆ members`;
    `setOntologyScope(null)` restores the previous root and selection.
13. `extractLensGraph` with `restrictTo` drops nodes outside the set *and*
    edges with either endpoint outside it.
14. `planOntologyExclude` emits both the exclude-set and the member-unset in
    one plan; `planOntologyAddExtends` returns `null` on a cycle.
15. Router: `/o/<id>` and `/o/<id>/graph` match; unknown ids fall back to the
    outline route rather than rendering an empty page.
16. `OntologyPage` renders a provenance label per member row.

Regression bar unchanged: `bun test`, `npm run typecheck`, `npm run check`,
`vp test` all green before merge.

### 2.8 Migration

- **Additive only.** New `sys.*` seed rows; no change to `KbNode`,
  `WireNode`, the datom builder, the JSONL format, or any existing action's
  schema. `ensureSystemSeed` already merges missing ids without rewriting
  existing ones.
- **Zero impact on non-participants.** A node that never joins an ontology has
  no ontology props (§2.3). Ontology bookkeeping is confined to
  `#ontology`-tagged nodes.
- **TODO content preserved** — enforced by test 9, not by assertion.
- **Backward compatible surfaces.** No HTTP/WS message shape changes; the WS
  protocol is untouched. An older client hitting a newer `.kb` sees ontology
  nodes as ordinary tagged nodes with unknown-field props — which the store
  already round-trips (`node-schema.ts` preserves unknown own properties).
- **Reversible.** Deleting the ontology nodes (`--force` for the `sys.*`
  seeds) returns the graph to its prior semantics exactly.

### 2.9 Explicitly NOT in core

Named so the implementer does not drift into them, and so the growth path is
on record:

- Tag inheritance (`sys.f.tag.extends`) and subtag-closure expansion.
- Set algebra beyond union + veto — `intersect`, `subtract`, ontology
  expressions.
- Relation vocabulary (`sys.f.onto.relations`); the core graph uses the
  perspective's existing `edge-kinds`.
- Ontology-scoped **datalog**: scoped `queryDb`, scoped `#query` node results,
  scoped WS subscriptions, scoped backlinks.
- Auto-admission of nodes created inside a scope; admission rules.
- Schema tab, coverage statistics, required-field reporting.
- The *Ontologies* chip row on a regular node's panel (join/leave from the
  node side). Core reaches membership from the ontology page only.
- Drag-and-drop membership; multi-select member operations.
- Per-ontology canvas scoping and `/o/<id>/canvas`.
- Per-ontology stored presentation defaults (`sys.f.lens.*` on the ontology
  node) and `sys.f.onto.lens`.
- Palette re-ranking of members, and the "add to ontology and stay" affordance
  when following a ref out of scope.
- Inference, auto-classification, validation enforcement, RDF/OWL/SKOS
  interchange, versioning/diffing (§1.7 — never core).

---

## 3. Open questions for the owner

1. **`extends` direction.** Spec above reads `A extends B` = "A is a superset,
   inheriting B's members". The opposite reading ("A is a specialisation of B")
   is equally defensible and is what OOP trains people to expect. Renaming the
   field to `sys.f.onto.includes-ontology` removes the ambiguity at the cost of
   an uglier name. Currently specced as `extends` = superset.
2. **Strict scope default.** `closure: "none"` means an ontology of `#todo`
   shows a flat list of todos, with non-member children hidden — faithful to
   "you only see nodes of such ontology". Confirm that hiding is preferred over
   showing greyed-out non-members.
3. **`#ontology` vs `#supertag-set`.** The owner's phrasing was "supertag
   sets"; `ontology` is the shorter and more general name, and the tag name is
   a one-line rename if it reads wrong.

## 4. Research-quality notes

- `.research/kb-refine/tana/report.md` was read as briefed but contains **no
  supertag-inheritance material** — §2.3 documents the "ADD SUPERTAG" menu and
  the schema page ("Everything tagged #todo") from stills only, and the report
  explicitly marks inheritance mechanics as not verifiable from capture. The
  design above therefore treats tag inheritance as an *anticipated* extension
  point (§1.3) rather than copying a mechanism kb has no evidence for.
- The `#graph-perspective` prior art (`INSPIRATIONS.md`, "kb-original") is the
  single most useful precedent here: a saved lens that is itself a node,
  configured by props, listed in the sidebar, picked from a popover. The
  ontology core deliberately clones its anatomy — same seed pattern, same
  picker component shape, same sidebar section, same "one graph, many lenses"
  pipeline — so it costs almost no new concepts.
- Every claim about existing behaviour in Part 2 is anchored to a read file or
  a live probe (§0); nothing here assumes a capability that was not checked.
