#!/usr/bin/env bun
/**
 * Git merge driver for `.kb/nodes.jsonl`.
 *
 * Registered per clone (git config is not versioned) alongside the hooks path:
 *
 *   git config merge.kb-jsonl.name "kb node store (three-way by node id)"
 *   git config merge.kb-jsonl.driver \
 *     "bun tools/kb/packages/app/cli/src/bin/merge-jsonl.ts %O %A %B %P"
 *
 * `.gitattributes` points both stores at it. Git passes the three versions as
 * files, expects the result written back over `%A`, and reads the exit status
 * as clean (0) or conflicted (non-zero).
 *
 * The merge itself is {@link mergeNodeSets} — this file is the git boundary
 * and nothing else: read three files, write one, choose an exit code.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJsonl, decodeStoredNode, mergeNodeSets, type KbNode } from "@kb/model";
import { writeErr } from "@kb/runtime";

/** An error and what caused it, on one line — git shows the driver's stderr. */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause === undefined ? err.message : `${err.message}: ${describe(err.cause)}`;
}

/** Parse one side. A side git never wrote (a fresh add) is an empty store. */
function readSide(path: string, label: string): KbNode[] {
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
      nodes.push(decodeStoredNode(JSON.parse(line)));
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

let result;
try {
  result = mergeNodeSets(
    readSide(basePath, "the merge base"),
    readSide(oursPath, "our side"),
    readSide(theirsPath, "their side"),
  );
} catch (err) {
  // Leave %A untouched: git falls back to reporting the path as conflicted
  // with our version in the worktree, which is recoverable by hand.
  writeErr(`merge-jsonl: ${shown}: ${describe(err)}`);
  process.exit(2);
}

writeFileSync(oursPath, canonicalJsonl(result.nodes));

if (result.conflicts.length > 0) {
  writeErr(`merge-jsonl: ${shown}: ${String(result.conflicts.length)} node(s) need a decision:`);
  for (const c of result.conflicts) writeErr(`  ${c.id}: ${c.reason}`);
  writeErr(
    "The file is valid JSONL with one side of each conflict kept. Fix those nodes with the kb CLI, then `git add` it.",
  );
  process.exit(1);
}
process.exit(0);
