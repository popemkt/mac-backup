import { runScenario, cleanup } from "./harness.ts";
const r = await runScenario("dst-many-7", { ops: 60 });
console.log("ops:", r.ops, "violations:", r.violations.length);
console.log(r.violations[0] ?? "(none)");
await cleanup(r);
