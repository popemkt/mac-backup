#!/usr/bin/env bun
// Regenerate all (or one: pass a view name) generated markdown docs from .kb data.
import { openKb, invoke } from "@kb/runtime";
import { kbDataRoot } from "@kb/server";

const root = kbDataRoot();
const view = process.argv[2];
const ctx = await openKb(root);
const receipt = await invoke(ctx, {
  id: "docs.materialize",
  input: view === undefined ? {} : { view },
});

if (receipt.status !== "succeeded") {
  console.error(`kb docs.materialize failed [${receipt.code}]: ${receipt.message}`);
  process.exit(1);
}

const out = receipt.output as { written: { view: string; output: string }[] };
for (const w of out.written) {
  console.log(`kb docs: wrote ${w.output} (view: ${w.view})`);
}
if (out.written.length === 0) {
  console.log("kb docs: no views found under .kb/views");
}
