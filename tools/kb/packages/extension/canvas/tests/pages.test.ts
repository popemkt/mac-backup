/**
 * A board's pages are the canvases under it in the outline, through canvases
 * only, and a page no chain of links reaches from the board is linted.
 */
import { describe, expect, test } from "bun:test";
import { SYSTEM_IDS, type KbNode } from "@kb/model";
import {
  CANVAS_IDS,
  boardOf,
  canvasPages,
  canvasWorld,
  lintCanvas,
  stringifyCanvasDoc,
  type CanvasItemLink,
} from "../src/index.ts";

type Spec = Pick<KbNode, "id" | "children"> & { links?: CanvasItemLink[] };

/** A canvas holding one item per link, each leading where it says. */
const canvas = ({ id, children, links = [] }: Spec) => ({
  id,
  text: `Page ${id}`,
  children,
  props: {
    [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: CANVAS_IDS.canvasTag }],
    [CANVAS_IDS.canvasField]: [
      {
        t: "str" as const,
        v: stringifyCanvasDoc({
          nodes: links.map((link, i) => ({
            id: `${id}.${i}`,
            type: "text",
            text: "",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            link,
          })),
          edges: [],
        }),
      },
    ],
  },
});
const note = (id: string, children: string[]) => ({ id, text: id, children, props: {} });

const world = canvasWorld([
  canvas({ id: "b", children: ["p1", "n", "p3"], links: [{ node: "p1" }, { url: "https://x.y" }] }),
  canvas({ id: "p1", children: ["p11"], links: [{ node: "p11", item: "x" }] }),
  canvas({ id: "p11", children: [], links: [{ node: "b" }] }),
  note("n", ["p2"]),
  canvas({ id: "p2", children: [] }),
  canvas({ id: "p3", children: [] }),
]);

describe("pages", () => {
  test("a board is the highest canvas reached up through canvases", () => {
    expect(["b", "p1", "p11", "p3"].map((id) => boardOf(world, id))).toEqual(["b", "b", "b", "b"]);
    // Under a node that is no canvas, a canvas is a board of its own.
    expect(boardOf(world, "p2")).toBe("p2");
  });

  test("its pages are itself, then the canvases under it in outline order, through canvases only", () => {
    expect(canvasPages(world, "p11")).toEqual(["b", "p1", "p11", "p3"]);
    expect(canvasPages(world, "p2")).toEqual(["p2"]);
  });

  test("a page no chain of links reaches from the board is linted, on every page of it", () => {
    const unreachable = (id: string) =>
      lintCanvas(id, world.docOf(id) ?? { nodes: [], edges: [] }, world)
        .filter((lint) => lint.rule === "unreachable-page")
        .map((lint) => lint.ids[0]);
    expect(unreachable("b")).toEqual(["p3"]);
    expect(unreachable("p11")).toEqual(["p3"]);
    expect(unreachable("p2")).toEqual([]);
  });
});
