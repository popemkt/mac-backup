/** Timing + memory helpers shared by every candidate runner. */

export interface Stat {
  label: string;
  rows: number;
  p50: number;
  p90: number;
  min: number;
  runs: number;
}

/**
 * p50 over `runs` iterations, with a budget escape: a query that costs seconds
 * (DataScript's recursive-rule fixpoint at 1 M datoms) stops after
 * BUDGET_MS of cumulative time and at least MIN_RUNS samples. `runs` in the
 * result says how many actually ran, so a 3-run row is never silently read as
 * a 20-run one.
 */
const BUDGET_MS = 8000;
const MIN_RUNS = 3;

export function timeIt(label: string, runs: number, fn: () => number): Stat {
  let rows = 0;
  const samples: number[] = [];
  let spent = 0;
  for (let i = 0; i < runs; i++) {
    if (i >= MIN_RUNS && spent > BUDGET_MS) break;
    const t = performance.now();
    rows = fn();
    const dt = performance.now() - t;
    spent += dt;
    samples.push(dt);
  }
  samples.sort((a, b) => a - b);
  const q = (p: number) => +samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]!.toFixed(3);
  return { label, rows, p50: q(0.5), p90: q(0.9), min: +samples[0]!.toFixed(3), runs };
}

export async function once<T>(fn: () => T | Promise<T>): Promise<{ ms: number; value: T }> {
  const t = performance.now();
  const value = await fn();
  return { ms: +(performance.now() - t).toFixed(1), value };
}

/**
 * Resident-set delta in MB. RSS rather than `heapUsed` on purpose: wasm
 * candidates (oxigraph, sql.js) hold their store outside the JS heap, so a
 * heap figure would flatter them into looking free. Bun is asked to GC first
 * where the flag allows it.
 */
export function rssMB(): number {
  return +(process.memoryUsage.rss() / 1024 / 1024).toFixed(1);
}

export function heapMB(): number {
  return +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
}

export function gc() {
  (globalThis as { gc?: () => void }).gc?.();
  Bun.gc?.(true);
}

export interface RunResult {
  candidate: string;
  scale: string;
  versions: Record<string, string>;
  nodes: number;
  datoms: number;
  coldLoadMs: Record<string, number>;
  rssDeltaMB: number;
  heapDeltaMB: number;
  queries: Stat[];
  incrementalMs?: Stat;
  persistence?: Record<string, number | string>;
  notes?: string[];
}

export async function writeResult(r: RunResult) {
  const path = new URL(`../results/${r.candidate}-${r.scale}.json`, import.meta.url).pathname;
  await Bun.write(path, JSON.stringify(r, null, 2) + "\n");
  const w = (n: number | undefined) => (n === undefined ? "—" : String(n));
  console.log(`\n=== ${r.candidate} @ ${r.scale} (${r.nodes} nodes / ${r.datoms} datoms) ===`);
  console.log(`cold load: ${JSON.stringify(r.coldLoadMs)}`);
  console.log(`rss delta: ${r.rssDeltaMB} MB   heap delta: ${r.heapDeltaMB} MB`);
  for (const q of r.queries) console.log(`  ${q.label.padEnd(26)} p50 ${String(q.p50).padStart(9)} ms  rows ${q.rows}`);
  if (r.incrementalMs) console.log(`  ${"incremental upsert".padEnd(26)} p50 ${String(r.incrementalMs.p50).padStart(9)} ms`);
  if (r.persistence) console.log(`persistence: ${JSON.stringify(r.persistence)}`);
  for (const n of r.notes ?? []) console.log(`note: ${n}`);
  console.log(`-> results/${r.candidate}-${r.scale}.json`);
}

export function scaleArg(): { file: string; scale: string } {
  const argv = Bun.argv;
  const scale = argv.includes("--scale") ? argv[argv.indexOf("--scale") + 1]! : "100k";
  return { file: new URL(`../data/${scale}.jsonl`, import.meta.url).pathname, scale };
}
