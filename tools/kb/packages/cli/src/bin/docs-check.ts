#!/usr/bin/env bun
// Pre-commit entry: exit 0 when generated docs match .kb data, 1 when stale.
import { invoke, openKb, writeErr, writeOut } from "@kb/runtime";
import { kbDataRoot } from "@kb/server";
import { checkOutput } from "@kb/ext-docs";

const root = kbDataRoot();
const ctx = await openKb(root);
const receipt = await invoke(ctx, { id: "docs.check", input: {} });

if (receipt.status !== "succeeded") {
  writeErr(`kb docs.check failed [${receipt.code}]: ${receipt.message}`);
  process.exit(2);
}

// The action declares this shape; parse it rather than assert it.
const out = checkOutput.parse(receipt.output);

if (out.clean) {
  writeOut(`kb docs: clean (${out.views.length} view${out.views.length === 1 ? "" : "s"})`);
  process.exit(0);
}

for (const v of out.views) {
  if (v.status !== "clean") {
    writeErr(`kb docs: ${v.status} — ${v.output} (view: ${v.view})`);
  }
}
writeErr(
  "kb docs out of date — run: bun tools/kb/src/bin/docs-materialize.ts, then stage the results",
);
process.exit(1);
