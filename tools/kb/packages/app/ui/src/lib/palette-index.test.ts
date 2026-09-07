import { describe, expect, it } from "vitest";
import { present } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import { buildPaletteIndex, searchPalette } from "@/lib/palette-index";
import { SYSTEM_IDS } from "@/lib/types";

const ISO = "2026-08-08T00:00:00.000Z";

function node(id: string, text: string, props: WireNode["props"] = {}): WireNode {
  return {
    id,
    text,
    props,
    children: [],
    createdAt: ISO,
    updatedAt: ISO,
  };
}

/**
 * Best of three: the fastest run is the one least interrupted by the host, so
 * it is the closest reading of the code's own cost on a shared machine.
 */
function bestOf(runs: number, work: () => number): number {
  let best = Infinity;
  for (let run = 0; run < runs; run++) {
    const started = performance.now();
    work();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/**
 * How many baseline substring passes a keystroke may cost. One pass is the
 * algorithm; the slack covers hit allocation, the sort, and timer noise on a
 * sub-millisecond measurement. A rebuild or a second full scan lands far above.
 */
const PASS_BUDGET = 8;

describe("palette index", () => {
  it("indexes all nodes including field/tag/sys/command", () => {
    const nodes = [
      node(SYSTEM_IDS.field, "sys.field"),
      node(SYSTEM_IDS.command, "sys.command"),
      node(SYSTEM_IDS.cmdAddNode, "Add node", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
      }),
      node("tag.todo", "todo", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
      }),
      node("n.1", "Ship palette"),
    ];
    const index = buildPaletteIndex(nodes, 3);
    expect(index.rev).toBe(3);
    expect(index.entries).toHaveLength(5);
    expect(index.entries.filter((e) => e.kind === "command")).toHaveLength(1);
    expect(index.entries.some((e) => e.id === SYSTEM_IDS.field)).toBe(true);
    expect(index.entries.some((e) => e.id === "tag.todo")).toBe(true);
  });

  it("fuzzy-matches over prebuilt haystack and caps at 20", () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node(`n.${i}`, `Node alpha ${i}`));
    nodes.push(
      node(SYSTEM_IDS.cmdGoQuery, "Go to query page", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
      }),
    );
    const index = buildPaletteIndex(nodes, 1);
    const hits = searchPalette(index, "query", 20);
    expect(hits.length).toBeGreaterThan(0);
    const hit = present(hits.at(0), "first hit");
    expect(hit.kind).toBe("command");
    expect(hit.id).toBe(SYSTEM_IDS.cmdGoQuery);

    const many = searchPalette(index, "alpha", 20);
    expect(many).toHaveLength(20);
  });

  it("keystroke search stays a single linear pass at 50k nodes", () => {
    const N = 50_000;
    const nodes: WireNode[] = [
      node(SYSTEM_IDS.command, "sys.command"),
      node(SYSTEM_IDS.cmdAddNode, "Add node", {
        [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.command }],
      }),
    ];
    for (let i = 0; i < N; i++) {
      nodes.push(node(`01BENCH${String(i).padStart(20, "0")}`, `node ${i}`));
    }

    const index = buildPaletteIndex(nodes, 1);
    const openHits = searchPalette(index, "", 20);
    expect(openHits).toHaveLength(20);
    expect(present(openHits.at(0), "first hit").kind).toBe("command");

    // Calibration, not a clock: an absolute millisecond bar measures how busy
    // the host is, so the gate is a ratio against one baseline substring pass
    // over the same entries, timed on the same host in the same run. Load
    // slows both sides equally. The claim under test is algorithmic — a
    // keystroke is one linear scan over the prebuilt haystack, so an index
    // rebuild or a second 50k subsequence pass blows the ratio anywhere.
    const baselineMs = bestOf(3, () => {
      let seen = 0;
      for (const entry of index.entries) seen += entry.textLower.indexOf("node 1234");
      return seen;
    });

    let keyHits: ReturnType<typeof searchPalette> = [];
    const keyMs = bestOf(3, () => {
      keyHits = searchPalette(index, "node 1234", 20);
      return keyHits.length;
    });

    expect(keyHits.length).toBeGreaterThan(0);
    expect(keyMs).toBeLessThan(baselineMs * PASS_BUDGET);

    // Observations. Recorded like the store benchmark table, asserted by nobody.
    console.info(
      `| palette 50k | ms |\n|---|---:|\n| baseline substring pass | ${baselineMs.toFixed(2)} |` +
        `\n| keystroke search | ${keyMs.toFixed(2)} |\n| passes | ${(keyMs / baselineMs).toFixed(2)} |`,
    );
  });
});
