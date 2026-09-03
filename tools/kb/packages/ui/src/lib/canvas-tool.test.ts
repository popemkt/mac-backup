import { describe, expect, test } from "vitest";
import { parseCanvasDoc, stringifyCanvasDoc, type CanvasDoc } from "@kb/canvas";
import { edgePath } from "@/components/canvas/edge-path";
import { createShapeNode, placeWithTool, reduceCanvasTool } from "@/lib/canvas-tool";

describe("canvas tool reducer", () => {
  test("set-tool switches active tool", () => {
    expect(reduceCanvasTool({ tool: "select" }, { type: "set-tool", tool: "rect" })).toEqual({
      tool: "rect",
    });
  });

  test("escape and placed revert to select", () => {
    expect(reduceCanvasTool({ tool: "diamond" }, { type: "escape" })).toEqual({ tool: "select" });
    expect(reduceCanvasTool({ tool: "ellipse" }, { type: "placed" })).toEqual({ tool: "select" });
  });
});

describe("placeWithTool", () => {
  const empty: CanvasDoc = { nodes: [], edges: [] };

  test("places rect and reverts tool", () => {
    const result = placeWithTool(empty, "rect", { x: 12, y: 34 }, "id-1");
    expect(result).not.toBeNull();
    expect(result!.nextTool).toBe("select");
    expect(result!.node).toMatchObject({
      id: "id-1",
      type: "shape",
      shape: "rect",
      x: 12,
      y: 34,
      width: 160,
      height: 100,
    });
    expect(result!.doc.nodes).toHaveLength(1);
  });

  test("places text card", () => {
    const result = placeWithTool(empty, "text", { x: 0, y: 0 }, "t1");
    expect(result!.node).toMatchObject({ type: "text", text: "" });
  });

  test("select and kb-node return null", () => {
    expect(placeWithTool(empty, "select", { x: 0, y: 0 }, "a")).toBeNull();
    expect(placeWithTool(empty, "kb-node", { x: 0, y: 0 }, "a")).toBeNull();
  });
});

describe("edge-to-shape connectivity", () => {
  test("edgePath connects shape nodes by id geometry", () => {
    const from = createShapeNode("rect", 0, 0, "s-from");
    const to = createShapeNode("ellipse", 300, 40, "s-to");
    const d = edgePath(from, to, {
      id: "e1",
      fromNode: from.id,
      toNode: to.id,
      fromSide: "right",
      toSide: "left",
    });
    expect(d.startsWith("M ")).toBe(true);
    expect(d).toContain(`${from.x + from.width}`);
    expect(d).toContain(`${to.x}`);
  });

  test("shape↔shape edge survives doc round-trip", () => {
    const from = createShapeNode("diamond", 10, 10, "a");
    const to = createShapeNode("rect", 200, 10, "b");
    const doc: CanvasDoc = {
      nodes: [from, to],
      edges: [
        {
          id: "e1",
          fromNode: "a",
          toNode: "b",
          fromSide: "right",
          toSide: "left",
          toEnd: "arrow",
        },
      ],
    };
    const again = parseCanvasDoc(stringifyCanvasDoc(doc));
    expect(again.edges[0]).toMatchObject({
      fromNode: "a",
      toNode: "b",
    });
    expect(again.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
