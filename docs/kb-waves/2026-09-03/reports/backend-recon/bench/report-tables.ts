/**
 * Renders the markdown tables in ../README.md from results/*.json, so the
 * report's numbers cannot drift from the runs that produced them.
 *
 * Usage: bun report-tables.ts > /tmp/tables.md
 */
import type { RunResult } from "./lib/bench.ts";

const dir = new URL("./results/", import.meta.url).pathname;
const files: string[] = [];
for await (const f of new Bun.Glob("*.json").scan({ cwd: dir })) files.push(f);
files.sort();

const results: RunResult[] = [];
for (const f of files) {
  const r = (await Bun.file(dir + f).json()) as RunResult & { failed?: boolean };
  if (!r.failed && r.coldLoadMs) results.push(r);
}

const ORDER = [
  "datascript",
  "datascript-snapshot",
  "sqlite-mem",
  "sqlite-file",
  "duckdb",
  "oxigraph",
  "ladybugdb",
  "typed-maps",
  "sql.js",
  "wa-sqlite-opfs",
];
const rank = (c: string) => {
  const i = ORDER.indexOf(c);
  return i === -1 ? 99 : i;
};
results.sort((a, b) => rank(a.candidate) - rank(b.candidate) || a.scale.localeCompare(b.scale));

const num = (n: number | undefined) => (n === undefined || n < 0 ? "—" : n.toLocaleString("en-US"));
const q = (r: RunResult, label: string) => {
  const s = r.queries.find((x) => x.label.startsWith(label));
  return s && s.p50 >= 0 ? s.p50 : undefined;
};

console.log("### 3.1 Cold load, memory, incremental update\n");
console.log(
  "| candidate | scale | nodes | datoms | cold load (ms) | RSS Δ (MB) | JS heap Δ (MB) | 1-node update (ms) | persisted restore (ms) |",
);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of results) {
  const restore =
    (r.persistence?.["restoreTotalMs"] as number | undefined) ??
    (r.persistence?.["reopenAndCountMs"] as number | undefined);
  console.log(
    `| ${r.candidate} | ${r.scale} | ${num(r.nodes)} | ${num(r.datoms)} | **${num(r.coldLoadMs["total"])}** | ${num(r.rssDeltaMB)} | ${num(r.heapDeltaMB)} | ${r.incrementalMs ? r.incrementalMs.p50 : "—"} | ${restore === undefined ? "—" : num(restore)} |`,
  );
}

console.log("\n### 3.2 Query latency, p50 ms\n");
const cols = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "CL", "PULL"];
console.log(`| candidate | scale | ${cols.join(" | ")} | search |`);
console.log(`|---|---|${cols.map(() => "---").join("|")}|---|`);
for (const r of results) {
  const search = q(r, "FTS5") ?? q(r, "substring");
  console.log(
    `| ${r.candidate} | ${r.scale} | ${cols.map((c) => q(r, c) ?? "—").join(" | ")} | ${search ?? "—"} |`,
  );
}

console.log("\n### 3.3 Cold-load breakdown, per stage (ms)\n");
for (const r of results) {
  console.log(`- \`${r.candidate}\` @ ${r.scale}: ${JSON.stringify(r.coldLoadMs)}`);
}

console.log(
  "\n---\n\n## 4. Row counts — the correctness gate\n\nEvery candidate answers the same eight questions over the same fixture, so a\nrow that differs is a candidate that did not implement the question rather than\none that was faster at it.\n",
);
console.log(`| candidate | scale | ${cols.join(" | ")} |`);
console.log(`|---|---|${cols.map(() => "---").join("|")}|`);
for (const r of results) {
  console.log(
    `| ${r.candidate} | ${r.scale} | ${cols.map((c) => r.queries.find((x) => x.label.startsWith(c))?.rows ?? "—").join(" | ")} |`,
  );
}

