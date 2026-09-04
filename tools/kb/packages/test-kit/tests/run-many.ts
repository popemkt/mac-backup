/**
 * Run many DST seeds on demand: `bun packages/test-kit/tests/run-many.ts [count]`.
 * Prints a one-line result per seed; any violation prints seed + op index so
 * it is a one-line reproduction (the seed alone reproduces the history).
 */
import { Effect } from "effect";
import { runScenario, cleanup, COMMITTED_SEEDS } from "../src/harness.ts";

const count = Number(process.argv[2] ?? 24);
const seeds = Array.from({ length: count }, (_, i) => `dst-many-${i}`);
const all = [...COMMITTED_SEEDS, ...seeds];

let failures = 0;
for (const seed of all) {
  const r = await Effect.runPromise(runScenario(seed, { ops: 60 }));
  if (r.violations.length > 0) {
    failures += 1;
    console.error(`FAIL seed=${seed} ops=${r.ops}`);
    for (const v of r.violations) console.error(`  ${v}`);
  } else {
    console.log(`ok   seed=${seed} ops=${r.ops} nodes=${r.nodes.length} bytes=${r.json.length}`);
  }
  await Effect.runPromise(cleanup(r));
}

console.log(
  failures === 0 ? `ALL ${all.length} SEEDS GREEN` : `${failures}/${all.length} SEEDS FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
