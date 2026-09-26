import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSPACE_ROOT, gitWorkspaceFiles } from "../src/workspace.ts";

/**
 * Harness check 5: Gap markers resolve (spec 11 / plan A.9 #5).
 *
 * Asserts:
 *   Every `GAP [[<id>]]` marker in code references a valid node in
 *   .kb/nodes.jsonl. If a #gap tag definition exists, the node must carry
 *   that tag, and the gap must still be open: a marker names a deferral that
 *   is still in force, so one that points at a `done` or `dropped` gap says
 *   something the code no longer means.
 *
 * Parse the JSONL directly; do not import kb.
 *
 * Red cases: add an unresolvable `// GAP [[01FAKE00000000000000000000]]`
 * marker, or cite a gap whose `status` is `done`.
 */

const NODES_JSONL = join(WORKSPACE_ROOT, "..", "..", ".kb", "nodes.jsonl");
const GAP_PATTERN = /GAP\s+\[\[([^\]]+)\]\]/g;

export interface KbNodeRecord {
  id: string;
  text?: string;
  props?: Record<string, Array<{ t: string; v: unknown }>>;
}

export function loadKbNodes(path: string = NODES_JSONL): Map<string, KbNodeRecord> {
  const nodes = new Map<string, KbNodeRecord>();
  if (!existsSync(path)) return nodes;

  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const node = JSON.parse(trimmed) as KbNodeRecord;
      if (node.id) nodes.set(node.id, node);
    } catch {
      // skip corrupted line
    }
  }

  return nodes;
}

export function findGapTagId(nodes: Map<string, KbNodeRecord>): string | null {
  for (const node of nodes.values()) {
    const types = node.props?.["sys.f.type"] ?? [];
    const isTag = types.some((ref) => ref.t === "ref" && ref.v === "sys.tag");
    if (isTag && node.text?.toLowerCase() === "gap") {
      return node.id;
    }
  }
  return null;
}

/** The `status` values that close a gap: its marker has nothing left to name. */
export const CLOSED_GAP_STATUSES: ReadonlySet<string> = new Set(["done", "dropped"]);

/** The `status` field node, found by what it is (a field named "status"), not by id. */
export function findStatusFieldId(nodes: Map<string, KbNodeRecord>): string | null {
  for (const node of nodes.values()) {
    const types = node.props?.["sys.f.type"] ?? [];
    const isField = types.some((ref) => ref.t === "ref" && ref.v === "sys.field");
    if (isField && node.text === "status") return node.id;
  }
  return null;
}

/** The closing status a gap carries, or null while it is open. */
export function closedStatusOf(node: KbNodeRecord, statusFieldId: string): string | null {
  for (const value of node.props?.[statusFieldId] ?? []) {
    if (typeof value.v === "string" && CLOSED_GAP_STATUSES.has(value.v)) return value.v;
  }
  return null;
}

export function findAllGapMarkers(root: string = WORKSPACE_ROOT): Array<{
  file: string;
  line: number;
  id: string;
}> {
  const files = gitWorkspaceFiles(["*.ts", "*.tsx", "*.css"], root);
  const markers: Array<{ file: string; line: number; id: string }> = [];

  for (const relFile of files) {
    if (relFile.startsWith("harness/")) continue;
    const absPath = join(root, relFile);
    if (!existsSync(absPath)) continue;

    const content = readFileSync(absPath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined || line === "") continue;
      GAP_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = GAP_PATTERN.exec(line)) !== null) {
        const id = match[1]?.trim();
        if (id !== undefined && id !== "") {
          markers.push({
            file: relFile,
            line: i + 1,
            id,
          });
        }
      }
    }
  }

  return markers;
}

describe("gap-markers-resolve", () => {
  const nodes = loadKbNodes(NODES_JSONL);
  const gapTagId = findGapTagId(nodes);
  const statusFieldId = findStatusFieldId(nodes);

  test(".kb/nodes.jsonl exists and contains valid nodes", () => {
    expect(existsSync(NODES_JSONL)).toBe(true);
    expect(nodes.size).toBeGreaterThan(10);
  });

  test("every GAP [[id]] in code names an existing node in .kb/nodes.jsonl", () => {
    const markers = findAllGapMarkers(WORKSPACE_ROOT);
    const missing: string[] = [];
    const notTaggedGap: string[] = [];
    const closed: string[] = [];

    for (const marker of markers) {
      const node = nodes.get(marker.id);
      if (!node) {
        missing.push(
          `${marker.file}:${marker.line}: GAP [[${marker.id}]] does not exist in .kb/nodes.jsonl`,
        );
        continue;
      }

      if (gapTagId !== null && gapTagId !== "") {
        const types = node.props?.["sys.f.type"] ?? [];
        const hasGapTag = types.some((ref) => ref.t === "ref" && ref.v === gapTagId);
        if (!hasGapTag) {
          notTaggedGap.push(
            `${marker.file}:${marker.line}: node ${marker.id} exists but is not tagged #gap`,
          );
        }
      }

      const status = statusFieldId === null ? null : closedStatusOf(node, statusFieldId);
      if (status !== null) {
        closed.push(
          `${marker.file}:${marker.line}: GAP [[${marker.id}]] is ${status}; delete the marker or cite the gap still open`,
        );
      }
    }

    expect(missing, `Unresolved GAP markers:\n${missing.join("\n")}`).toEqual([]);
    expect(
      notTaggedGap,
      `GAP markers referencing nodes without #gap tag:\n${notTaggedGap.join("\n")}`,
    ).toEqual([]);
    expect(closed, `GAP markers citing closed gaps:\n${closed.join("\n")}`).toEqual([]);
  });

  test("a marker that cites a done gap is red", () => {
    const statusField = "f.status";
    const done: KbNodeRecord = { id: "g", props: { [statusField]: [{ t: "str", v: "done" }] } };
    const open: KbNodeRecord = { id: "g", props: { [statusField]: [{ t: "str", v: "todo" }] } };
    expect(closedStatusOf(done, statusField)).toBe("done");
    expect(closedStatusOf(open, statusField)).toBeNull();
    expect(statusFieldId).not.toBeNull();
  });
});
