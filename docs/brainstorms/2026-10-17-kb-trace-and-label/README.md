# Tracing connections and labelling them

Plan of 2026-10-17. Nothing here is built. It builds on
[DESIGN.md → Query layer](../../../tools/kb/DESIGN.md#query-layer-horizontal),
on the refs and fields of the Data model, and on
[DESIGN-UI.md → Graph](../../../tools/kb/DESIGN-UI.md#graph-i2) and
→ Field-based graph perspectives. It restates none of them. Index:
[2026-10-17-kb-overnight-plans.md](../2026-10-17-kb-overnight-plans.md).

## What the owner asked

> "ability to trace connections to make out new insights, (also labeling connections where appropriate, probably under a toggle)"

## What exists today

- **`reach`** answers transitive reachability in datalog. DESIGN.md says why
  it stops there: "Path reconstruction and a minimum hop count are not in the
  form: a path is not a datalog relation".
- **The edge projection.**
  - It lives in `collectEdges`, in `kit/ui-sdk/src/lib/graph-lens.ts`, which
    is browser only.
  - Its kinds are `mention` (text tokens), `child`, and `prop:<fieldId>`, with
    `ref-prop` meaning every ref field (`EdgeKind`, `@kb/views` `lens.ts`).
  - The lens field `lens.edge-kinds` picks them from `sys.graph.sources`, the
    relationship options containment, mentions and references, plus field
    nodes (`@kb/model` `graph-schema.ts`).
  - Parallel edges of one kind are merged into a `weight`.
- **Neighbourhoods** are `graph-neighbourhood.ts` (`reachAttribute`).
- **Typed relations already exist.** A ref field is one, and its edge kind
  `prop:<field>` names the field node, whose text is the label. The graph does
  not draw edge labels.
- **The canvas's `kbLink`** binds a ref prop from a drawn edge, once.

## Prior art

- **Paths.**
  - The Obsidian Path Finder plugin has "Find Shortest Path" and "Find All
    Paths As Graph", with a maximum length
    (https://community.obsidian.md/plugins/obsidian-path-finder).
  - Neo4j's `SHORTEST k` and `ALL SHORTEST` (bidirectional BFS) are the
    general reference
    (https://neo4j.com/docs/cypher-manual/current/patterns/shortest-paths/).
- **Unexpected connections.**
  - Graph Analysis gives co-citations, Jaccard similarity, Adamic-Adar and
    common neighbours as scored tables relative to the current note
    (https://github.com/SkepticMystic/graph-analysis).
  - InfraNodus finds structural gaps between weakly connected Louvain
    clusters, and ranks betweenness to find "conceptual gateways"
    (https://infranodus.com/docs/network-structural-gaps).
  - Smart Connections uses a local embedding model with an index in
    `.smart-env/`
    (https://github.com/brianpetro/obsidian-smart-connections).
- **Typed relations.**
  - Breadcrumbs: edge fields up, same, down, next and prev, and "every real
    relation implies the opposite relation" behind an Implied Relations toggle,
    with implied edges marked
    (https://publish.obsidian.md/breadcrumbs-docs/Edge+Fields,
    https://breadcrumbs-wiki.onrender.com/docs/Getting%20Started/Relationships).
  - Juggl labels edges from the bullet form `- up [[father]]` and styles them
    by CSS (https://forum.obsidian.md/t/how-to-create-juggl-typed-links-edge-annotation/44477).
  - ExcaliBrain infers its relations without fields: a forward link is a
    child, a backlink a parent, a mutual link friends
    (https://github.com/zsviczian/excalibrain).
  - Dataview's inline fields: `key:: [[x]]`
    (https://blacksmithgu.github.io/obsidian-dataview/annotation/add-metadata/).
  - Tana: fields are nodes, and "options from supertag" values are references
    (https://outliner.tana.inc/learn/features/fields).

kb already holds Tana's model: a relation is a field node. So labelling is
a question of display and typing, not a new data model.

## The concept in kb's terms

**Trace and suggest are read projections. Labelling is display plus a typing
action.**

- **(a) Trace.** A path between two nodes over an edge projection: the lens's
  edge kinds over a node set. Each hop is one edge, with its kind, its
  direction and its label.
- **(a) Suggest.** For one node, the nodes the chosen kinds do not connect to
  it, but whose structure says they are related: shared neighbours, shared
  tags, co-citation. Each comes with a score and reasons.
- **(b) Label.** A labelled connection is a ref field, and the field node is
  the label. "Labelling a mention" means typing it: adding a ref prop of a
  chosen field from the source to the target, and keeping the text.

The framing I was handed, tested:

- **Nearly all of it is kept.**
- **The edge projection moves to shared code.** Trace must run on the server
  for the CLI, MCP and the agent, and Rule 1 wants one owner for "the edges
  of a node set, by kind". So `collectEdges` moves into the graph family's
  shared package, `@kb/graph`, which O4 creates. Trace and the renderers then
  read one function.
- **Tags need no new edge kind.** A tag is `prop:sys.f.type`, inside
  "references". But tag nodes are hubs, and every `#todo` connects through
  one, so trace must damp hubs. By default it elides `sys.*` intermediates, as
  the graph already does.
- **Text similarity is deferred.** Embeddings are a non-adoption for now.
- **Inverse labels: yes**, as optional text on the field node. Implied edges
  are never written.

## Where it lives

The graph family, which is optional and on by default. All of this waits for
O4, which cuts the family out.

| Package | Scope | Holds |
|---|---|---|
| `@kb/graph` | shared | `edgesOf(nodes, kinds)` (the moved `collectEdges`), `trace`, `suggest`, `explainHop`; the action definitions; the lens params |
| `@kb/graph` server entry (shared, isomorphic) | — | handlers for `graph.trace`, `graph.suggest`, `graph.relation.type`, so the page can answer reads locally too |
| `@kb/graph-ui` | browser | trace mode in the renderers, edge labels, the suggestion panel |
| core seed (`@kb/model`) | shared | `sys.f.relation.inverse`: a field on field nodes, because the data model and the outline's References section read it too |

The ids are `ext.graph.trace`, `ext.graph.suggest` and
`ext.graph.relation.type`, aliased `graph.trace`, `graph.suggest` and
`graph.relation.type`. They sit beside core's `graph.query` and `graph.search`
without colliding.

## Data model

- **No stored trace results.**
- **A saved trace is a graph view node.** Its lens params are
  `lens.trace-from` and `lens.trace-to` (refs, one each) and `lens.trace-paths`
  (number, k). The renderer's node set is the union of the k paths and their
  ends. The renderer keys declare the params, so the settings panel enables
  them as it does any param. An unsaved trace is transient selection state,
  like search and legend dimming.
- **`lens.edge-labels`** is a checkbox, one, on graph view nodes. It is the
  toggle, and it is persisted per perspective, as the link style is.
- **A label is the field node's text.** `sys.f.relation.inverse` is optional
  text on a field node ("influenced by"). It is used when a hop is read
  against its direction, and in the References section ("A influences →
  this").
- **The suggestions toggle** (owner question 2) is a gap-1 config slot
  `graph.suggest-relations` (checkbox, default off) on `sys.extension.graph`.
- **Typing.** `graph.relation.type {source, target, field}` (write) adds one
  ref prop to the source in one transaction, with no change to the text.
  - It refuses a field that is not a ref, and a target outside
    `allowedRefIdsOf`. It runs that constraint through the one resolver; the
    write check does not enforce it yet (a recorded gap in DESIGN.md).
  - It is idempotent.
  - A person's gesture never asks. An agent asks through a policy node in
    this repository's store ("An agent asks before typing a relation"), the
    pattern of `approval.agent-extension-switch`. It declares no approval,
    so the CLI actor is not blocked.

## Algorithms

- **`trace(edges, from, to, {k = 3, maxHops = 6, includeSystem = false,
  visitCap})`.**
  - It runs BFS over the undirected view of the projection and keeps each
    edge's direction for the explanation.
  - Yen's algorithm gives the k shortest simple paths.
  - Cost is the number of hops. A tie goes to the lower sum of `log(degree)`
    over the intermediates, so specific connectors beat hubs.
  - Hitting the visit cap returns the paths found so far, with a warning. A
    broken definition never fails.
- **`suggest(edges, id, {limit = 10})`.**
  - Candidates are the nodes within two hops and not directly connected under
    the kinds.
  - The score is Adamic-Adar over shared neighbours (Σ 1/log deg z), plus
    shared non-`sys` tags weighted by tag rarity (idf), plus co-citation
    (both referenced by one node).
  - Each candidate carries its reasons: `{shared, tags, citedBy}`.
  - The order is deterministic.
- **`explainHop`** turns each hop into a sentence, for example:
  - "A mentions B";
  - "B contains C";
  - "C —influences→ D";
  - "E —influences→ D, read back as D ←influenced by— E".
- **Scale.** This repository's store holds thousands of nodes, so plain BFS
  over a projection is milliseconds. DataScript is not involved. That is
  consistent with "a path is not a datalog relation".

## Typed mentions (owner question 1)

Typing `[[x]]` in A leaves the text token and adds `field: x`. Today that
draws two edges, `mention` and `prop:field`. That is right as provenance, and
noise once the person has said what the mention means.

Recommended: when a source has a ref prop and a text mention to the same
target, `edgesOf` folds the mention into the prop edge. The prop edge's
weight rises by one, and it carries `carriers: ["mention", "prop"]`.

This changes DESIGN.md's "each kind is read from its own carrier and they stay
disjoint". There is a narrow exception: a lens that shows mentions but not
that field still draws the mention. The rule lives in the one projection, not
in a renderer.

## Surfaces

- **CLI.** These are sugar over the actions, as `kb backlinks` is:
  - `kb trace <a> <b> [--kinds mention,child,prop:<field>] [--k 3] [--json]`;
  - `kb suggest <id> [--json]`;
  - `kb relate <source> <target> <field>`.
- **MCP, WebMCP and the agent.** The actions are listed with no extra code.
  The agent proposes labels from `graph.suggest`, or from its own reading of
  the screen block, and calls `graph.relation.type`. The sidebar's existing
  approval card asks the person.
- **The graph UI.**
  - **Tracing.** Select A, then "Trace to…" and B (or ⇧-select B). The paths
    light in place, with the neighbourhood lighting reused and everything else
    dimmed.
  - **The info card** lists the paths with their explanations. "Save as
    perspective" writes the trace params.
  - **Edge labels** have a toggle in the settings panel, enabled only where
    the renderer declares the capability. 2D comes first; 3D label billboards
    are a gap, as the 3D link weight already is.
  - **Suggestions.** With the toggle on, the info card lists "Related, not
    connected". Each row has a "Link as…" field picker that leads to
    `graph.relation.type`.
- **The outline** (after O3, in its family):
  - the References section shows a typed relation's label, or its inverse
    label;
  - with the suggestions toggle on, a mention chip gains "Type this
    reference…".

## The contract suite

- **The projection is the same after the move.** `edgesOf` gives the same
  edges as today's `collectEdges` on the existing graph-lens fixtures, and the
  `graph-lens.test.ts` cases move with it.
- **Trace properties**, over generated graphs:
  - every path is a path of the projection under the kinds, and paths are
    ordered by cost;
  - the first path's length equals the BFS distance;
  - disconnected nodes give no paths and a reason;
  - cycles terminate;
  - the visit cap warns and does not fail;
  - `sys.*` elision is honoured.
- **Suggest properties:**
  - it never suggests a pair the kinds already connect;
  - the score does not fall as shared neighbours are added;
  - the order is deterministic.
- **One answer on both hosts.** The server action and the page's local read
  answer the same, because they run the same isomorphic function.
- **`graph.relation.type`:**
  - it writes exactly one ref prop and is idempotent;
  - it refuses a field that is not a ref, and a target outside the allowed
    set;
  - an agent's call asks under the policy, and that case joins
    `surfaceContract`.
- **Renderers.** A renderer that declares edge labels enables the toggle, and
  the render suite draws 2D labels.

## Steps

All of them wait for O4. The two outline steps also wait for O3.

| Step | What | Kind | Size |
|---|---|---|---|
| T0 | `collectEdges` and `EdgeKind` move into `@kb/graph` as `edgesOf`, and the `ui-sdk` export goes. Behaviour unchanged | restructure | S |
| T1 | `trace`, `suggest`, `explainHop`, as pure functions with property tests | add | M |
| T2 | `graph.trace` and `graph.suggest`; `kb trace`, `kb suggest` | add | S |
| T3 | Trace mode in the 2D renderers; the lens params for a saved trace | add | M |
| T4 | Seed `sys.f.relation.inverse`; `graph.relation.type`, `kb relate`; the agent policy node | add | S |
| T5 | `lens.edge-labels` and 2D edge labels | add | M |
| T6 | Typed mentions fold into their prop edge (if the owner agrees) | restructure | S |
| T7 | The suggestions panel; the outline's "Type this reference" and inverse labels (after O3; the toggle slot needs gap 1) | add | M |
| T8 | DESIGN.md and DESIGN-UI.md | docs | S |

## Questions for the owner

1. **Fold a mention into its typed relation when both join the same pair.**
   *Recommended: yes.*
2. **Where the toggles live.** Edge labels go per perspective (`lens.edge-labels`).
   Suggestions go in one family-wide slot on `sys.extension.graph`, which
   needs gap 1. *Recommended: as stated.*
3. **Inverse labels as plain text on the field**, against implied relations
   in the Breadcrumbs style. *Recommended: text.* Nothing new is written, and
   the store needs no reasoner.
4. **Text similarity.** *Recommended: defer, and add no embeddings.*
5. **The agent labels one relation per call, each with its own approval**,
   against a batch the person approves in one card. *Recommended: one per call
   now.* A batch needs a new approval shape.

## Non-adoptions

- **Paths as a datalog relation.** DESIGN.md refuses it.
- **An embeddings index** in the Smart Connections style. It would be a
  derived index with a model dependency, and could come later as an
  extension.
- **Community detection and structural-gap scores** in the InfraNodus style.
  The cluster renderer already groups; betweenness can come later.
- **Implied or inverse edges written to the store.**
- **Edges as first-class nodes (reification).** A relation is a field. A note
  about one connection is a contextual reference node, which is the existing
  kind.
- **Typing mentions automatically, without approval.**
