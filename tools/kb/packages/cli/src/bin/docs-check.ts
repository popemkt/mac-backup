#!/usr/bin/env bun
// Pre-commit entry: exit 0 when generated docs match .kb data, 1 when stale.
import { openKb } from "@kb/runtime";
import { invoke } from "@kb/runtime";

const root = process.env.KB_ROOT ?? process.cwd();
const ctx = await openKb(root);
const receipt = await invoke(ctx, { id: "docs.check", input: {} });

if (receipt.status !== "succeeded") {
  console.error(`kb docs.check failed [${receipt.code}]: ${receipt.message}`);
  process.exit(2);
}

const out = receipt.output as {
  clean: boolean;
  views: { view: string; output: string; status: string }[];
};

if (out.clean) {
  console.log(`kb docs: clean (${out.views.length} view${out.views.length === 1 ? "" : "s"})`);
  process.exit(0);
}

for (const v of out.views) {
  if (v.status !== "clean") {
    console.error(`kb docs: ${v.status} — ${v.output} (view: ${v.view})`);
  }
}
console.error(
  "kb docs out of date — run: bun tools/kb/src/bin/docs-materialize.ts, then stage the results",
);
process.exit(1);
