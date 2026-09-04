/** Every figure quoted in ../README.md prose, pulled from results/. */
import type { RunResult } from "./lib/bench.ts";
const dir = new URL("./results/", import.meta.url).pathname;
const out: Record<string, unknown> = {};
for await (const f of new Bun.Glob("*.json").scan({ cwd: dir })) {
  const r = (await Bun.file(dir + f).json()) as RunResult;
  if (!r.coldLoadMs) continue;
  const g = (l: string) => r.queries.find((x) => x.label.startsWith(l))?.p50;
  out[`${r.candidate}@${r.scale}`] = {
    cold: r.coldLoadMs["total"],
    stages: r.coldLoadMs,
    rss: r.rssDeltaMB,
    heap: r.heapDeltaMB,
    Q1: g("Q1"), Q2: g("Q2"), Q3: g("Q3"), Q4: g("Q4"), Q5: g("Q5"), Q6: g("Q6"),
    CL: g("CL"), PULL: g("PULL"), search: g("FTS5") ?? g("substring"),
    PATH: g("PATH"), SHORTEST: g("SHORTEST"),
    inc: r.incrementalMs?.p50,
    persistence: r.persistence,
  };
}
console.log(JSON.stringify(out, null, 1));
