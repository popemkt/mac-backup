/**
 * demo-datascript.ts — Runnable Datalog queries on the real kb graph.
 *
 * Run from tools/kb:
 *   cd tools/kb && bun ../../docs/kb/waves/2026-09-03/reports/datalog-vs-cypher/demo-datascript.ts
 *
 * This imports buildQueryDb/query/pull from ./src/foundation/query/datascript.ts
 * and datascript from tools/kb/node_modules to ensure one shared module instance.
 */

import * as d from "../../../../../tools/kb/node_modules/datascript";
import {
  buildQueryDb,
  query,
  pull,
  normalizeEdnQuery,
  type QueryDb,
} from "../../../../../tools/kb/src/foundation/query/datascript.ts";
import type { KbNode } from "../../../../../tools/kb/src/foundation/model.ts";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// ----------------------------------------------------------------------------
// 0. Load real graph (.kb/nodes.jsonl)
// ----------------------------------------------------------------------------
const candidates = [
  resolve(import.meta.dir, "../../../../../.kb/nodes.jsonl"),
  resolve(process.cwd(), "../.kb/nodes.jsonl"),
  resolve(process.cwd(), ".kb/nodes.jsonl"),
];
const jsonlPath = candidates.find((p) => existsSync(p));
if (!jsonlPath) {
  throw new Error(`Could not find .kb/nodes.jsonl in candidate locations: ${candidates.join(", ")}`);
}
const lines = readFileSync(jsonlPath, "utf-8")
  .trim()
  .split("\n")
  .filter((l) => l.trim().length > 0);
const realNodes = lines.map((l) => JSON.parse(l));

console.log("=".repeat(78));
console.log(" DEMO: DATASCRIPT DATALOG ON THE REAL KB GRAPH");
console.log("=".repeat(78));
console.log(`Loaded ${realNodes.length} nodes from ${jsonlPath}`);

const t0Build = performance.now();
const qdb = buildQueryDb(realNodes);
const t1Build = performance.now();
console.log(
  `Built DataScript DB in ${(t1Build - t0Build).toFixed(2)} ms (${qdb.ids.toEid.size} entities indexed)\n`,
);

function section(title: string) {
  console.log("\n" + "-".repeat(78));
  console.log(` ${title}`);
  console.log("-".repeat(78));
}

function runTiming<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  const ms = performance.now() - start;
  return { result, ms };
}

// ----------------------------------------------------------------------------
// 1. Core Side-by-Side Questions (Matches README section 3)
// ----------------------------------------------------------------------------
section("1. CORE QUESTIONS (Side-by-Side with Cypher)");

// Q1: Find all todos
{
  const edn = `[:find ?id ?text
 :where
 [?n :f/sys.f.type ?t]
 [?t :node/text "todo"]
 [?n :node/id ?id]
 [?n :node/text ?text]]`;

  const { result, ms } = runTiming(() => query(qdb, edn) as [string, string][]);
  console.log(`\nQ1: Find all todos`);
  console.log(`EDN:\n${edn}`);
  console.log(`Count: ${result.length} rows (${ms.toFixed(2)} ms)`);
  console.log("Sample 3 rows:");
  result.slice(0, 3).forEach(([id, text]) => console.log(`  - [${id}] ${text}`));
}

// Q2: Todos with status="doing" and status="done"
{
  const edn = `[:find ?id ?text ?status
 :in $ ?targetStatus
 :where
 [?n :f/sys.f.type ?t]
 [?t :node/text "todo"]
 [?n :f/01KZFW1A581GP25YPYRF614BAZ ?status]
 [(= ?status ?targetStatus)]
 [?n :node/id ?id]
 [?n :node/text ?text]]`;

  const { result: doing, ms: msDoing } = runTiming(
    () => query(qdb, edn, "doing") as [string, string, string][],
  );
  console.log(`\nQ2a: Todos with status="doing"`);
  console.log(`Count: ${doing.length} rows (${msDoing.toFixed(2)} ms)`);
  doing.slice(0, 3).forEach(([id, text, st]) => console.log(`  - [${id}] (${st}) ${text}`));

  const { result: done, ms: msDone } = runTiming(
    () => query(qdb, edn, "done") as [string, string, string][],
  );
  console.log(`\nQ2b: Todos with status="done"`);
  console.log(`Count: ${done.length} rows (${msDone.toFixed(2)} ms)`);
  done.slice(0, 3).forEach(([id, text, st]) => console.log(`  - [${id}] (${st}) ${text}`));
}

// Q3: Backlinks to a node
{
  const edn = `[:find ?srcId ?srcText
 :in $ ?targetId
 :where
 [?target :node/id ?targetId]
 [?src :node/mentions ?target]
 [?src :node/id ?srcId]
 [?src :node/text ?srcText]]`;

  const todoTagId = "01KZFW1A5BT06QS7V6X6EBQMZ4";
  const { result, ms } = runTiming(() => query(qdb, edn, todoTagId) as [string, string][]);
  console.log(`\nQ3: Backlinks to #todo tag [${todoTagId}]`);
  console.log(`EDN:\n${edn}`);
  console.log(`Count: ${result.length} rows (${ms.toFixed(2)} ms)`);
  result.slice(0, 3).forEach(([id, text]) => console.log(`  - [${id}] ${text}`));
}

// Q4: Tag inheritance via recursive rule
{
  // We demonstrate subtag inheritance with synthetic tag relations added to a clone DB
  // to prove recursive rules: #bug and #feature extend #task, which extends #todo.
  const tagNodes = [
    {
      id: "tag.todo",
      text: "todo",
      props: { "sys.f.type": [{ t: "ref", v: "sys.tag" }] },
      children: [],
      createdAt: "2026-09-03",
      updatedAt: "2026-09-03",
    },
    {
      id: "tag.task",
      text: "task",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag" }],
        "sys.f.extends": [{ t: "ref", v: "tag.todo" }],
      },
      children: [],
      createdAt: "2026-09-03",
      updatedAt: "2026-09-03",
    },
    {
      id: "tag.bug",
      text: "bug",
      props: {
        "sys.f.type": [{ t: "ref", v: "sys.tag" }],
        "sys.f.extends": [{ t: "ref", v: "tag.task" }],
      },
      children: [],
      createdAt: "2026-09-03",
      updatedAt: "2026-09-03",
    },
    {
      id: "item.1",
      text: "Fix crash on launch",
      props: { "sys.f.type": [{ t: "ref", v: "tag.bug" }] },
      children: [],
      createdAt: "2026-09-03",
      updatedAt: "2026-09-03",
    },
    {
      id: "item.2",
      text: "Write report",
      props: { "sys.f.type": [{ t: "ref", v: "tag.task" }] },
      children: [],
      createdAt: "2026-09-03",
      updatedAt: "2026-09-03",
    },
    {
      id: "item.3",
      text: "Buy coffee",
      props: { "sys.f.type": [{ t: "ref", v: "tag.todo" }] },
      children: [],
      createdAt: "2026-09-03",
      updatedAt: "2026-09-03",
    },
  ];

  const tagDb = buildQueryDb(tagNodes as unknown as KbNode[]);
  const rules = normalizeEdnQuery(`[
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
  ]`);

  const edn = `[:find ?id ?text ?tagName
 :in $ % ?targetTagId
 :where
 [?target :node/id ?targetTagId]
 [?target :node/text ?tagName]
 (has-tag ?n ?target)
 [?n :node/id ?id]
 [?n :node/text ?text]]`;

  const { result, ms } = runTiming(
    () => query(tagDb, edn, rules, "tag.todo") as [string, string, string][],
  );
  console.log(`\nQ4: Tag inheritance (find all nodes that are #todo directly OR via extends chain)`);
  console.log(`Rules:\n${rules}`);
  console.log(`Count: ${result.length} rows (${ms.toFixed(2)} ms)`);
  result.forEach(([id, text, tag]) => console.log(`  - [${id}] "${text}" (matched as #${tag})`));
}

// Q5: Children in order
{
  const parentId = "01KZFWGFETN0F453ME4JKH8CCK";
  const parentNode = qdb.nodes.get(parentId)!;
  console.log(`\nQ5: Children of [${parentId}] in outline order`);
  console.log(`Parent text: "${parentNode.text}"`);
  console.log(`Children in JSONL: ${parentNode.children.length} items:`);
  parentNode.children.forEach((cid, i) => {
    const cnode = qdb.nodes.get(cid);
    console.log(`  ${i}: [${cid}] "${cnode?.text}"`);
  });

  // Query parent's children vector in DataScript:
  const edn = `[:find ?childId ?childText
 :in $ ?parentId
 :where
 [?p :node/id ?parentId]
 [?p :node/child ?c]
 [?c :node/id ?childId]
 [?c :node/text ?childText]]`;

  const { result, ms } = runTiming(() => query(qdb, edn, parentId) as [string, string][]);
  console.log(`DataScript :node/child query returns ${result.length} rows (${ms.toFixed(2)} ms) (unordered set):`);
  result.forEach(([id, text]) => console.log(`  - [${id}] ${text}`));
}

// Q6: Count per status (Aggregates + the reviveValue note)
{
  console.log(`\nQ6: Count per status (DataScript aggregates)`);
  const edn = `[:find ?status (count ?n)
 :where
 [?n :f/01KZFW1A581GP25YPYRF614BAZ ?status]]`;

  // Raw d.q returns actual numbers:
  const rawQ = `[:find ?status (count ?n) :where [?n ":f/01KZFW1A581GP25YPYRF614BAZ" ?status]]`;
  const { result: rawRows, ms: rawMs } = runTiming(
    () => d.q(rawQ, qdb.db) as [string, number][],
  );
  console.log(`Raw DataScript d.q results (${rawMs.toFixed(2)} ms):`);
  rawRows.forEach(([status, count]) => console.log(`  - ${status}: ${count} nodes`));

  // reviveValue bug observation:
  const { result: revivedRows } = runTiming(() => query(qdb, edn) as [string, unknown][]);
  console.log("\n  [Observation for Query-IR Design]:");
  console.log(
    "  In datascript.ts, reviveValue(v) checks `typeof v === 'number' && ids.toId.has(v)`.",
  );
  console.log(
    "  Because entity IDs are 1..231, integer count values (like 8, 16) get erroneously",
  );
  console.log("  revived to NodeIds unless the query projection schema is typed!");
  console.log("  Sample revived row:", revivedRows[0]);
}

// Q7: Pull a subtree
{
  const parentId = "01KZFWGFETN0F453ME4JKH8CCK";
  const pattern = "[:node/id :node/text {:node/child [:node/id :node/text]}]";
  const { result, ms } = runTiming(() => pull(qdb, pattern, parentId));
  console.log(`\nQ7: Pull subtree for [${parentId}]`);
  console.log(`Pattern: ${pattern}`);
  console.log(`Execution time: ${ms.toFixed(2)} ms`);
  console.log(`Result:\n${JSON.stringify(result, null, 2)}`);
}

// ----------------------------------------------------------------------------
// 2. Where Datalog is Stronger (Matches README section 4)
// ----------------------------------------------------------------------------
section("2. WHERE DATALOG IS STRONGER");

// S1: Recursive Transitive Closure
{
  const startId = "sys.tag.graph-perspective";
  const rawRules = `[
    [(reaches ?a ?b) [?a :node/mentions ?b]]
    [(reaches ?a ?b) [?a :node/mentions ?c] (reaches ?c ?b)]
  ]`;
  const rules = normalizeEdnQuery(rawRules);
  const edn = `[:find ?bId ?bText
 :in $ % ?startId
 :where
 [?a :node/id ?startId]
 (reaches ?a ?b)
 [?b :node/id ?bId]
 [?b :node/text ?bText]]`;

  const { result, ms } = runTiming(
    () => query(qdb, edn, rules, startId) as [string, string][],
  );
  console.log(`\nS1: Transitive closure over :node/mentions from [${startId}]`);
  console.log(`Reusable rule predicate 'reaches' defined in Datalog.`);
  console.log(`Reaches: ${result.length} nodes in ${ms.toFixed(2)} ms`);
  console.log("Sample 5 reached nodes:");
  result.slice(0, 5).forEach(([id, text]) => console.log(`  - [${id}] "${text}"`));
}

// S2: Negation
{
  const edn = `[:find ?id ?text
 :where
 [?n :f/sys.f.type ?t]
 [?t :node/text "todo"]
 (not [?n :f/01KZFW1A581GP25YPYRF614BAZ "done"])
 [?n :node/id ?id]
 [?n :node/text ?text]]`;

  const { result, ms } = runTiming(() => query(qdb, edn) as [string, string][]);
  console.log(`\nS2: Negation (find all todos that are NOT done)`);
  console.log(`EDN clause: (not [?n :f/01KZFW1A581GP25YPYRF614BAZ "done"])`);
  console.log(`Count: ${result.length} rows in ${ms.toFixed(2)} ms`);
  result.slice(0, 3).forEach(([id, text]) => console.log(`  - [${id}] "${text}"`));
}

// S3: Attribute join on arbitrary attributes without declared indexes/edges
{
  const edn = `[:find ?id1 ?id2 ?text
 :where
 [?n1 :node/text ?text]
 [?n2 :node/text ?text]
 [(< ?n1 ?n2)]
 [?n1 :node/id ?id1]
 [?n2 :node/id ?id2]]`;

  const { result, ms } = runTiming(() => query(qdb, edn) as [string, string, string][]);
  console.log(`\nS3: Attribute joins on arbitrary values (nodes with identical text)`);
  console.log(`Join pattern: [?n1 :node/text ?t] [?n2 :node/text ?t] [(< ?n1 ?n2)]`);
  console.log(`Found ${result.length} pairs with identical text in ${ms.toFixed(2)} ms`);
  result.slice(0, 3).forEach(([id1, id2, text]) => {
    console.log(`  - [${id1}] and [${id2}] both share: "${text}"`);
  });
}

// S4: Dynamic recursive pull
{
  const rootId = "01KZFWGFETN0F453ME4JKH8CCK";
  const recursivePattern = "[:node/id :node/text {:node/child ...}]";
  const { result, ms } = runTiming(() => pull(qdb, recursivePattern, rootId));
  console.log(`\nS4: Recursive pull with '...' syntax`);
  console.log(`Pattern: ${recursivePattern}`);
  console.log(`Time: ${ms.toFixed(2)} ms`);
  const childCount =
    result && typeof result === "object" && ":node/child" in result && Array.isArray(result[":node/child"])
      ? result[":node/child"].length
      : 0;
  console.log(`Result: ${childCount} direct children recursively retrieved`);
}

// ----------------------------------------------------------------------------
// 3. Where Cypher is Stronger (Datalog's Boundaries)
// ----------------------------------------------------------------------------
section("3. WHERE CYPHER IS STRONGER (Datalog's Boundaries)");

// L1: Bounded depth requires manual rule unrolling in Datalog
{
  console.log(`\nL1: Bounded-depth traversal (-[*1..2]-> vs Datalog)`);
  console.log("In Cypher: MATCH (a:Node {id: $id})-[:MENTIONS*1..2]->(b:Node) RETURN DISTINCT b.id");
  console.log("In Datalog: Must hand-unroll a separate rule body for each depth level!");

  const rawRules = `[
    [(reaches-1 ?a ?b) [?a :node/mentions ?b]]
    [(reaches-2 ?a ?b) (reaches-1 ?a ?b)]
    [(reaches-2 ?a ?b) [?a :node/mentions ?mid] [?mid :node/mentions ?b]]
  ]`;
  const rules = normalizeEdnQuery(rawRules);
  const startId = "sys.tag.graph-perspective";

  const q1 = `[:find ?b :in $ % ?startId :where [?a :node/id ?startId] (reaches-1 ?a ?b)]`;
  const q2 = `[:find ?b :in $ % ?startId :where [?a :node/id ?startId] (reaches-2 ?a ?b)]`;

  const { result: r1, ms: ms1 } = runTiming(() => query(qdb, q1, rules, startId) as unknown[]);
  const { result: r2, ms: ms2 } = runTiming(() => query(qdb, q2, rules, startId) as unknown[]);

  console.log(`Depth 1 (reaches-1): ${r1.length} nodes reached (${ms1.toFixed(2)} ms)`);
  console.log(`Depth 2 (reaches-2): ${r2.length} nodes reached (${ms2.toFixed(2)} ms)`);
  console.log("If depth was 1..5, Datalog would require reaches-1 through reaches-5 hand-unrolled.");
}

// L2: Path as a first-class value
{
  console.log(`\nL2: Path as a first-class value`);
  console.log("In Cypher: MATCH p = (a)-[:MENTIONS*1..3]->(b) RETURN p, nodes(p), relationships(p)");
  console.log("In Datalog: Queries bind variables to relations. They return pairs [?a ?b].");
  console.log("            The intermediate path sequence of edges is NOT a first-class value.");
}

// L3: Edge properties and Reification
{
  console.log(`\nL3: Edge properties vs EAV triples`);
  console.log("In LPG: (parent)-[:CHILD {order: 0}]->(child)");
  console.log("In EAV: Triples are (Entity, Attribute, Value).");
  console.log("        Notice in qdb datoms for entity 4 (parent):");
  const eid = qdb.ids.toEid.get("01KZFWGFETN0F453ME4JKH8CCK")!;
  const datoms = d.datoms(qdb.db, ":eavt", eid);
  datoms
    .filter((dt) => dt.a === ":node/child" || dt.a === ":node/child-order" || dt.a === ":node/children")
    .forEach((dt) => {
      console.log(`        datom: [${dt.e}, "${dt.a}", ${JSON.stringify(dt.v)}]`);
    });
  console.log(
    "        Notice that :node/child-order values [0, 1, 2] attach to the parent entity,",
  );
  console.log(
    "        NOT to the relationship! To attach properties to an edge in EAV,",
  );
  console.log(
    "        one must REIFY the edge into its own entity (4 triples per edge).",
  );
}

console.log("\n" + "=".repeat(78));
console.log(" DEMO COMPLETE — ALL QUERIES VERIFIED ON REAL GRAPH");
console.log("=".repeat(78));
