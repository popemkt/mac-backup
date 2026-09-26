#!/usr/bin/env bun
/**
 * Git merge driver for `.kb/nodes.jsonl`.
 *
 * Git runs it through `tools/kb/bin/merge-jsonl`, which is what the clone
 * registers (tools/kb/AGENTS.md) and which falls back to git's text merge
 * when this file cannot run. `.gitattributes` points both stores at it. Git
 * passes the three versions as files, expects the result written back over
 * `%A`, and reads the exit status.
 *
 * The merge itself is `mergeNodeSets` — this file is the git boundary and
 * nothing else: read three files, write one, choose an exit code. The codes
 * are 0 merged, 1 merged with nodes that need a decision, 2 could not merge
 * (`%A` untouched). The model is imported inside the `try`, so a clone whose
 * dependencies are missing is a 2 with a reason, never a crash git would read
 * as a conflict.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { KbNode } from "@kb/model";

/** Git shows the driver's stderr; each message is one line. */
function writeErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** An error and what caused it, on one line — git shows the driver's stderr. */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause === undefined ? err.message : `${err.message}: ${describe(err.cause)}`;
}

/** Parse one side. A side git never wrote (a fresh add) is an empty store. */
function readSide(decode: (value: unknown) => KbNode, path: string, label: string): KbNode[] {
  let body: string;
  try {
    body = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${label} (${path})`, { cause: err });
  }
  const nodes: KbNode[] = [];
  const lines = body.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    try {
      nodes.push(decode(JSON.parse(line)));
    } catch (err) {
      throw new Error(`${label} is not a valid node store at line ${String(i + 1)}`, {
        cause: err,
      });
    }
  }
  return nodes;
}

const [basePath, oursPath, theirsPath, displayPath] = process.argv.slice(2);
if (basePath === undefined || oursPath === undefined || theirsPath === undefined) {
  writeErr("merge-jsonl: expected %O %A %B [%P]");
  process.exit(2);
}
const shown = displayPath ?? oursPath;

let body: string;
let conflicts: readonly { id: string; reason: string }[];
try {
  const { canonicalJsonl, decodeStoredNode, mergeNodeSets } = await import("@kb/model");
  const result = mergeNodeSets(
    readSide(decodeStoredNode, basePath, "the merge base"),
    readSide(decodeStoredNode, oursPath, "our side"),
    readSide(decodeStoredNode, theirsPath, "their side"),
  );
  body = canonicalJsonl(result.nodes);
  conflicts = result.conflicts;
} catch (err) {
  // Leave %A untouched; the wrapper falls back to git's text merge.
  writeErr(`merge-jsonl: ${shown}: ${describe(err)}`);
  process.exit(2);
}

writeFileSync(oursPath, body);

if (conflicts.length > 0) {
  writeErr(`merge-jsonl: ${shown}: ${String(conflicts.length)} node(s) need a decision:`);
  for (const c of conflicts) writeErr(`  ${c.id}: ${c.reason}`);
  writeErr(
    "The file is valid JSONL with one side of each conflict kept. Fix those nodes with the kb CLI, then `git add` it.",
  );
  process.exit(1);
}
process.exit(0);
