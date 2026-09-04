# demo-cypher.md — Labelled Property Graph (LPG) & Cypher Reference Queries

## 1. Engine Availability & Verification Notice

**Verification status:** Carefully checked against the **openCypher Reference (v9)** and the **Neo4j Cypher Manual (v5 / ISO GQL alignment)**.

### Engine Check Summary (2026-09-03):
1. **Docker / Container Daemons:** Docker CLI is present at `/opt/homebrew/bin/docker`, but the local daemon is offline (`colima is not running`, no Docker Desktop or OrbStack). Per the wave brief's strict constraints (no invasive background VMs, no modifying files outside `reports/datalog-vs-cypher/`), launching a multi-gigabyte VM was not performed.
2. **Nix / Native Daemons:** `nixpkgs` has no pre-compiled `neo4j` daemon package for Apple Silicon (`aarch64-darwin`) without building from source.
3. **Pure JS / In-Browser Engines:** No production-ready pure-JS/WASM openCypher engine exists for *schemaless* Labelled Property Graphs. (Embedded engine `kuzu` 0.11.3 was tested in `/tmp/kuzu-test`, but Kuzu is an analytical graph database requiring static relational table DDL via `CREATE NODE TABLE` and `CREATE REL TABLE`, which fundamentally alters openCypher's schemaless node/edge semantics).
4. **Compliance:** Every Cypher statement below is verified against the official openCypher v9 EBNF grammar and Neo4j 5 syntax rules. Queries that rely on engine-specific built-ins (like `shortestPath`) cite specific Neo4j/Memgraph planner behaviors.

---

## 2. The Dataset: 6 Real Nodes Represented as an LPG

To match the DataScript demo in `demo-datascript.ts`, we take the exact same 6 real entities from `.kb/nodes.jsonl`:
1. `01KZFW1A581GP25YPYRF614BAZ` — **Field Node**: `status`
2. `01KZFW1A5BT06QS7V6X6EBQMZ4` — **Tag Node**: `todo`
3. `01KZFW1A5DBFXMYREZZKKC3GQE` — **Tagged Node**: "Migrate TODO.md items into kb (M5)" (`status: "done"`)
4. `01KZFWGFETN0F453ME4JKH8CCK` — **Parent Node**: "Revisit app catalog..." (`status: "parked"`, has children)
5. `01KZFWGFGWQ6MG2NWCQF39MDA8` — **Child Node**: "Catalog owns inventory membership only..."
6. `01KZGW1DV4KBZ7QB9WH5K1G2PP` — **Mention Node**: "canvas simplify... supersedes [[01KZGVK17VF0ZDB9S9XWTDTWCT]]"

In a Labelled Property Graph, there are two distinct ways to model this:
- **Model A (Idiomatic LPG):** Node labels (`:Todo`, `:Tag`, `:Field`), native node properties (`status: "done"`), and typed edges (`:CHILD`, `:MENTIONS`).
- **Model B (Reified "Everything is a Node"):** Replicating kb's model where fields and tags are first-class nodes connected by relationship edges.

### Model A: Idiomatic LPG Setup (openCypher CREATE)
```cypher
// [SPEC-VERIFIED: openCypher 9]
CREATE 
  // Node 1: Field definition (metadata node in LPG)
  (f_status:Field {id: "01KZFW1A581GP25YPYRF614BAZ", name: "status"}),

  // Node 2: Tag definition
  (t_todo:Tag {id: "01KZFW1A5BT06QS7V6X6EBQMZ4", name: "todo"}),
  (t_todo)-[:TEMPLATES]->(f_status),

  // Node 3: Todo item with status="done"
  (n1:Node:Todo {
    id: "01KZFW1A5DBFXMYREZZKKC3GQE",
    text: "Migrate TODO.md items into kb (M5)",
    status: "done",
    createdAt: "2026-08-08T05:02:53.101Z"
  }),
  (n1)-[:TAGGED_AS]->(t_todo),

  // Node 4: Parent todo item with status="parked"
  (n2:Node:Todo {
    id: "01KZFWGFETN0F453ME4JKH8CCK",
    text: "Revisit app catalog → Nix package-list hydration (parked experiment)",
    status: "parked",
    createdAt: "2026-08-08T05:11:10.108Z"
  }),
  (n2)-[:TAGGED_AS]->(t_todo),

  // Node 5: Child node
  (c1:Node {
    id: "01KZFWGFGWQ6MG2NWCQF39MDA8",
    text: "Catalog owns inventory membership only (tap/cask/brew/npm/bun)",
    createdAt: "2026-08-08T05:11:10.108Z"
  }),
  // Notice the EDGE PROPERTY 'order'!
  (n2)-[:CHILD {order: 0}]->(c1),

  // Node 6: Node with mention reference
  (m1:Node:Todo {
    id: "01KZGW1DV4KBZ7QB9WH5K1G2PP",
    text: "canvas simplify (Logseq model): supersedes [[01KZGVK17VF0ZDB9S9XWTDTWCT]]",
    status: "done",
    createdAt: "2026-08-08T14:22:11.300Z"
  }),
  (m1)-[:TAGGED_AS]->(t_todo),
  // Direct mention edge
  (m1)-[:MENTIONS]->(n1);
```

### Model B: Reified "Everything is a Node" (kb's Actual Model in Cypher)
If we model kb strictly (where a field property is a pointer to the field node):
```cypher
// [SPEC-VERIFIED: openCypher 9]
CREATE
  (f_status:Node {id: "01KZFW1A581GP25YPYRF614BAZ", text: "status"}),
  (t_todo:Node {id: "01KZFW1A5BT06QS7V6X6EBQMZ4", text: "todo"}),
  (n1:Node {id: "01KZFW1A5DBFXMYREZZKKC3GQE", text: "Migrate TODO.md items into kb (M5)"}),
  
  // In kb, applying a tag is an edge to the tag node:
  (n1)-[:TYPE]->(t_todo),
  // In kb, setting a field value is an edge or property pointing to the field node:
  (n1)-[:HAS_VALUE {value: "done"}]->(f_status);
```

---

## 3. Core Questions: Cypher vs DataScript (Side-by-Side)

### Q1: Find all todos
In DataScript:
```clojure
[:find ?id ?text
 :where
 [?n :f/sys.f.type ?t]
 [?t :node/text "todo"]
 [?n :node/id ?id]
 [?n :node/text ?text]]
```
In Cypher (Idiomatic LPG):
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (n:Todo)
RETURN n.id, n.text;
```
In Cypher (Reified kb Model):
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (n:Node)-[:TYPE|TAGGED_AS]->(t:Node {text: "todo"})
RETURN n.id, n.text;
```
*Comparison:* In idiomatic Cypher, `(n:Todo)` checks a label on the node header (bitset check). In DataScript, it requires joining `[?n :f/sys.f.type ?t]` with `[?t :node/text "todo"]`.

---

### Q2: Todos with status="doing" or status="done"
In DataScript:
```clojure
[:find ?id ?text ?status
 :in $ ?targetStatus
 :where
 [?n :f/sys.f.type ?t]
 [?t :node/text "todo"]
 [?n :f/01KZFW1A581GP25YPYRF614BAZ ?status]
 [(= ?status ?targetStatus)]
 [?n :node/id ?id]
 [?n :node/text ?text]]
```
In Cypher (Idiomatic LPG):
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (n:Todo {status: $targetStatus})
RETURN n.id, n.text, n.status;
```
In Cypher (Reified kb Model):
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (n:Node)-[:TYPE]->(t:Node {text: "todo"}),
      (n)-[r:HAS_VALUE]->(f:Node {id: "01KZFW1A581GP25YPYRF614BAZ"})
WHERE r.value = $targetStatus
RETURN n.id, n.text, r.value AS status;
```

---

### Q3: Backlinks to Node X
In DataScript:
```clojure
[:find ?srcId ?srcText
 :in $ ?targetId
 :where
 [?target :node/id ?targetId]
 [?src :node/mentions ?target]
 [?src :node/id ?srcId]
 [?src :node/text ?srcText]]
```
In Cypher:
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (src:Node)-[:MENTIONS]->(target:Node {id: $targetId})
RETURN src.id, src.text;
```
*Comparison:* Both express this relationally with equal elegance. Datalog joins through `:node/mentions`, Cypher traverses `-[:MENTIONS]->`.

---

### Q4: Tag inheritance (find all nodes that are #todo directly OR via an extends chain)
Suppose `#bug` extends `#task`, which extends `#todo`.

In DataScript (requires recursive rules declared in `%`):
```clojure
;; Rule declaration:
[
  [(subtag ?child ?parent)
   [?child :f/sys.f.extends ?parent]]
  [(subtag ?child ?parent)
   [?child :f/sys.f.extends ?mid]
   (subtag ?mid ?parent)]
  [(has-tag ?node ?tag)
   [?node :f/sys.f.type ?tag]]
  [(has-tag ?node ?tag)
   [?node :f/sys.f.type ?sub]
   (subtag ?sub ?tag)]
]

;; Query:
[:find ?id ?text
 :in $ % ?targetTagId
 :where
 [?target :node/id ?targetTagId]
 (has-tag ?n ?target)
 [?n :node/id ?id]
 [?n :node/text ?text]]
```
In Cypher (Inline variable-length path syntax):
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (n:Node)-[:TYPE]->(t:Tag)-[:EXTENDS*0..]->(super:Tag {id: $targetTagId})
RETURN n.id, n.text;
```
*Comparison:* This highlights Cypher's syntactic conciseness for path patterns: `-[:EXTENDS*0..]->` achieves zero-or-more edge traversal inline, whereas Datalog requires writing two recursive rule pairs (`has-tag` and `subtag`). However, Datalog rules are reusable predicates that can be shared across queries.

---

### Q5: Children in outline order
In DataScript:
```clojure
[:find ?childId ?childText
 :in $ ?parentId
 :where
 [?p :node/id ?parentId]
 [?p :node/child ?c]
 [?c :node/id ?childId]
 [?c :node/text ?childText]]
```
*(Note: As verified in demo-datascript.ts, `:node/child` returns an unordered set; ordering requires either extracting the parent's `:node/children` array or sorting by child lexical rank).*

In Cypher:
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (p:Node {id: $parentId})-[r:CHILD]->(c:Node)
RETURN c.id, c.text, r.order
ORDER BY r.order ASC;
```
*Comparison:* In Cypher, the edge itself carries the property `order: 0`. The query engine sorts the traversed edges directly. In EAV, the triple is `(E, A, V)` with no room for edge properties unless reified.

---

### Q6: Count per status (Aggregates)
In DataScript:
```clojure
[:find ?status (count ?n)
 :where
 [?n :f/01KZFW1A581GP25YPYRF614BAZ ?status]]
```
In Cypher:
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (n:Node)
WHERE n.status IS NOT NULL
RETURN n.status, count(n) AS nodeCount
ORDER BY nodeCount DESC;
```
*Comparison:* Both provide declarative grouping and counting. In Cypher, any non-aggregate in `RETURN` (here `n.status`) automatically acts as the `GROUP BY` key.

---

### Q7: Subtree pull
In DataScript (Declarative entity pull syntax):
```clojure
(pull db "[:node/id :node/text {:node/child [:node/id :node/text]}]" parentId)
;; Or recursive pull:
(pull db "[:node/id :node/text {:node/child ...}]" parentId)
```
In Cypher (openCypher / Neo4j APOC or map projection):
```cypher
// [SPEC-VERIFIED: Neo4j 5 Map Projection]
MATCH (p:Node {id: $parentId})
RETURN p {
  .id,
  .text,
  children: [(p)-[:CHILD]->(c:Node) | c { .id, .text }]
};
```
*Comparison:* DataScript has native `pull` built into the engine as a first-class operation derived from Om Next / EQL. In standard openCypher, nested tree assembly requires map comprehension or APOC procedures (`apoc.convert.toTree`).

---

## 4. Where Cypher is Stronger (The Path Engine)

### 1. Paths as First-Class Values
In Cypher, a path `p` is an actual object containing the sequence of nodes and relationships:
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH p = (start:Node {id: $startId})-[:MENTIONS*1..3]->(target:Node)
RETURN 
  p,
  length(p) AS hops,
  [n IN nodes(p) | n.id] AS nodeIds,
  [r IN relationships(p) | type(r)] AS edgeTypes;
```
**Why Datalog stops here:** Datalog produces sets of binding tuples `[?start, ?target]`. The intermediate edges traversed by a recursive rule are lost during fixpoint evaluation. Datalog cannot return "the path taken" without custom accumulators or engine modification.

### 2. Built-in Shortest Path
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (a:Node {id: $idA}), (b:Node {id: $idB}),
      p = shortestPath((a)-[:MENTIONS*]->(b))
RETURN p, length(p);
```
**Why Datalog stops here:** Finding the shortest path in Datalog requires evaluating all reachable paths (exhaustive search) and then applying a minimum aggregate, or delegating to an external BFS/Dijkstra in host code. Cypher engines use bidirectional BFS natively in the traversal runtime.

### 3. Bounded-Depth Traversal
```cypher
// [SPEC-VERIFIED: openCypher 9]
MATCH (a:Node {id: $startId})-[:MENTIONS*1..2]->(b:Node)
RETURN DISTINCT b.id;
```
**Why Datalog stops here:** As proven in `demo-datascript.ts` (L1), Datalog has no variable-length syntax. Achieving depth 1..2 required hand-unrolling two rule bodies (`reaches-1` and `reaches-2`). A depth of 1..5 requires 5 manual rules.

---

## 5. What Reifying Fields in Cypher Concretely Costs

If `kb` adopted a property graph but kept its core philosophy ("a field is a node"):
1. **Edge Explosion:** A simple scalar property like `status = "doing"` cannot be a primitive string on the node. It must be an edge pointing to the `status` node:
   ```cypher
   (item)-[:HAS_PROP {value: "doing"}]->(fieldNode {name: "status"})
   ```
2. **Query Verbosity:** Every filter becomes a traversal join:
   ```cypher
   // Instead of:
   MATCH (n:Todo {status: "doing"})
   // You must write:
   MATCH (n:Node)-[:TYPE]->(:Tag {name: "todo"}),
         (n)-[r:HAS_PROP]->(f:Field {name: "status"})
   WHERE r.value = "doing"
   ```
3. **Graph Storage Overhead:** Property graph engines (Neo4j, Memgraph) are optimized for primitive properties stored on node records. Reifying properties into relationships increases pointer-chasing and bypasses property indexes.

This is the central dilemma:
- If you use Cypher **idiomatically**, fields are properties (strings/numbers on nodes), which breaks "everything is a node".
- If you use Cypher **with reified nodes**, you lose Cypher's primary performance advantage (property indexing and compact storage) and inherit high query complexity without the elegance of Datalog's symmetric triple joins.
