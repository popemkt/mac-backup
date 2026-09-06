#!/usr/bin/env bun
// Verify rule-to-check links and their evidence, wiring, enforcement, gates, and homes.
import { auditOutput } from "@kb/ext-check";
import { invoke, openKb, writeErr, writeOut } from "@kb/runtime";
import { kbDataRoot } from "@kb/server";

const root = kbDataRoot();
const ctx = await openKb(root);
const receipt = await invoke(ctx, { id: "ext.check.audit", input: {} });

if (receipt.status !== "succeeded") {
  writeErr(`kb ext.check.audit failed [${receipt.code}]: ${receipt.message}`);
  process.exit(2);
}

const out = auditOutput.parse(receipt.output);

if (out.clean) {
  writeOut("kb checks: clean");
  process.exit(0);
}

for (const finding of out.findings) {
  const subject = "rule" in finding ? `rule ${finding.rule}` : `check ${finding.check}`;
  writeErr(`${finding.kind} — ${finding.message} (${subject})`);
}
process.exit(1);
