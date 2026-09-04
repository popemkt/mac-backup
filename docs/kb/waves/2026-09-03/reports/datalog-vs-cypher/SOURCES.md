# Primary Sources and Reference Citations

Every conceptual claim, syntax specification, and performance comparison in this report is grounded in primary documentation and formal specifications. Below are the primary sources and the specific sections referenced.

---

## 1. DataScript Documentation & Source Code

*Source:* Nikita Prokopov (tonsky), **DataScript** (Immutable database and Datalog query engine in Clojure/ClojureScript and JS).  
*Repository:* https://github.com/tonsky/datascript  
*Installed instance tested:* `datascript@1.8.1` in `tools/kb/node_modules/datascript`

*Specific sections and claims leant upon:*
- **EAV Triple Store Architecture (`datascript.core/init_db`, `datoms`):**  
  DataScript models data as atomic datom tuples: `[entity-id, attribute, value, tx, added]`. Attributes are flat strings/keywords. Index structure maintains `EAVT`, `AEVT`, and `AVET` index b-trees.
- **Schema & Reference Attributes (`datascript.core` schema spec):**  
  Used in `tools/kb/src/foundation/query/datascript.ts`:
  - `:db/valueType: :db.type/ref` defines reference joins where values must resolve to entity IDs.
  - `:db/cardinality: :db.cardinality/many` models multi-valued relations as unordered sets.
  - `:db/unique: :db.unique/identity` models entity identity.
- **Rules Vector & Recursion Semantics (`datascript.query/q`):**  
  Passed via `%` in query signatures `[:find ... :in $ % ... :where ...]`. Rules are evaluated via semi-naive evaluation to find recursive fixpoints.  
  *Limitation verified:* DataScript rules do not support arithmetic functions in recursion heads, requiring manual unrolling for bounded-depth traversals (`reaches-1`, `reaches-2`).
- **Entity Pull API (`datascript.pull`):**  
  Declarative graph projection syntax supporting attribute vectors `[:node/id :node/text]`, nested join maps `{:node/child [:node/id]}`, and recursive wildcards `{:node/child ...}`.
- **Negation (`datascript.query`):**  
  Stratified negation using `(not [clause])` and `(not-join [vars] [clause])` syntax.

---

## 2. Datomic Query Reference

*Source:* Cognitect / Rich Hickey, **Datomic Documentation: Query & Rules Reference**  
*URL:* https://docs.datomic.com/on-prem/query/query.html  
*URL (Pull):* https://docs.datomic.com/on-prem/query/pull.html

*Specific sections and claims leant upon:*
- **Datalog Syntax & Pattern Matching:**  
  Section *Data Patterns* — `[?entity ?attribute ?value]` matching against fact tuples. Variable unification across clauses forms natural relational joins without explicit index declarations.
- **Rule Definitions & Reusability:**  
  Section *Rules* — Rule syntax `[[(rule-name ?param1 ?param2) clause1 clause2 ...]]`. Rules act as reusable logical views and predicates that can be shared across multiple independent queries.
- **Stratified Negation:**  
  Section *Negation* — Negation semantics requiring all variables inside `(not ...)` to be bound by previous positive clauses or explicitly bound via `(not-join ...)`.
- **Relational vs Path-Centric Model:**  
  Section *Datalog vs Graph Traversal* — Datomic/Datalog operates over sets of tuples (relations), producing relation tables as outputs rather than graph paths as values.

---

## 3. openCypher Specification & ISO GQL

*Source:* openCypher Consortium / Neo4j Inc., **openCypher Reference, Version 9**  
*URL:* https://opencypher.org/resources/  
*Standard:* ISO/IEC 39075:2024 — Information technology — Database languages — GQL (Graph Query Language).

*Specific sections and claims leant upon:*
- **Labelled Property Graph (LPG) Data Model:**  
  Section 2.1 *Data Model* — A graph consists of Nodes and Relationships. Nodes have zero or more labels and a property map. Relationships are directed, typed, have identity, and have a property map.
- **Pattern Matching Clauses:**  
  Section 3.1 *MATCH Clause* — ASCII-art graph patterns: `(n:Label {prop: val})-[r:TYPE {prop: val}]->(m)`.
- **Variable-Length Path Patterns:**  
  Section 3.1.3 *Variable-length relationships* — Syntax `-[*minHops..maxHops]->`. Bounded and unbounded graph traversal syntax natively supported by query syntax.
- **Path Functions:**  
  Section 4.5 *Path functions* — `nodes(path)` returning the list of nodes, `relationships(path)` returning the list of edges, `length(path)` returning the number of edges.

---

## 4. Neo4j Cypher Manual & Planner Architecture

*Source:* Neo4j Inc., **Neo4j Cypher Manual (v5)**  
*URL:* https://neo4j.com/docs/cypher-manual/current/

*Specific sections and claims leant upon:*
- **Shortest Path Algorithms:**  
  Section *Built-in Path Functions: shortestPath and allShortestPaths* — Engine-level bidirectional breadth-first search (BFS) evaluated directly during traversal planning.
- **Map Projections:**  
  Section *Map Projections* — `node { .property, relationship: [...] }` syntax used for tree projections in Cypher.
- **Property Graph Reification Costs:**  
  Section *Graph Modeling Best Practices* — Discussion on the tradeoff between native node properties (compact, indexed by property indexes) and reified relationship entities (which introduce intermediate nodes, increase pointer chasing, and complicate traversals).

---

## 5. Memgraph Documentation

*Source:* Memgraph, **Graph Traversal and Path Finding Algorithms**  
*URL:* https://memgraph.com/docs/querying/graph-algorithms  
*Specific sections and claims leant upon:*
- **In-Memory Traversal Performance:**  
  High-speed pointer traversal over adjacency lists for variable-length paths (`-[*1..3]->`) compared to relational set joins.

---

## 6. Academic Foundations

- **Ceri, Gottlob, & Tanca (1989):** *What You Always Wanted to Know About Datalog (And Were Afraid to Ask)*, IEEE Transactions on Knowledge and Data Engineering, 1(1), 146–166.  
  *Foundational paper establishing:* Horn clause logic, fixpoint semantics, semi-naive evaluation, and computational complexity of recursive Datalog.
- **Angles, Arenas, Barceló, Hogan, Reutter, & Vrgoc (2018):** *Foundations of Modern Query Languages for Graph Databases*, ACM Computing Surveys, 50(5), 1–40.  
  *Foundational survey establishing:* Formal differences between Labelled Property Graphs (LPGs) and RDF/triple-based graph models, expressive power of recursive graph patterns vs Datalog, and the path-oriented semantics of Cypher.
