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

  it("meets perf bar at 50k nodes: open <50ms, keystroke <10ms", () => {
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

    // Best of 3: absolute wall-clock bars flake when the host is loaded,
    // and the bar guards the algorithm, not a busy CI core.
    let openMs = Infinity;
    let index = buildPaletteIndex(nodes, 1);
    let openHits = searchPalette(index, "", 20);
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      index = buildPaletteIndex(nodes, run + 1);
      openHits = searchPalette(index, "", 20);
      openMs = Math.min(openMs, performance.now() - t0);
    }

    expect(openHits).toHaveLength(20);
    expect(present(openHits.at(0), "first hit").kind).toBe("command");
    expect(openMs).toBeLessThan(50);

    let keyMs = Infinity;
    let keyHits: ReturnType<typeof searchPalette> = [];
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      keyHits = searchPalette(index, "node 1234", 20);
      keyMs = Math.min(keyMs, performance.now() - t0);
    }

    expect(keyHits.length).toBeGreaterThan(0);
    expect(keyMs).toBeLessThan(10);
  });
});
