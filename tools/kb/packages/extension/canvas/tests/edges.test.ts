/**
 * Where an edge runs (`edges.ts`): an end meets its item at an anchor carried
 * onto the outline its shape draws, a side's middle being one; the route
 * runs between the two ends as its `route` says; each end wears the head
 * JSON Canvas's end and kb's head say, written back in both forms. The
 * format's new fields round-trip, and what kb cannot read in them stays.
 */
import { describe, expect, test } from "bun:test";
import {
  anchorNear,
  connectItems,
  edgeHead,
  edgeRoute,
  headOf,
  outlinePoints,
  parseCanvasDoc,
  routeMidpoint,
  routePoints,
  sideTerminal,
  stringifyCanvasDoc,
  withEnd,
  withHead,
  withRoute,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
} from "../src/index.ts";

const rect: CanvasNode = { id: "r", type: "text", text: "", x: 0, y: 0, width: 200, height: 100 };
const ellipse: CanvasNode = {
  id: "e",
  type: "shape",
  shape: "ellipse",
  x: 400,
  y: 0,
  width: 200,
  height: 100,
};
const diamond: CanvasNode = {
  id: "d",
  type: "shape",
  shape: "diamond",
  x: 0,
  y: 300,
  width: 200,
  height: 100,
};
const edge = (more: Partial<CanvasEdge> = {}): CanvasEdge => ({
  id: "x",
  fromNode: "r",
  toNode: "e",
  ...more,
});

describe("anchors", () => {
  test("an edge leaves by the right and arrives by the left, a side's middle", () => {
    const route = edgeRoute(rect, ellipse, edge());
    expect(route.from).toEqual(sideTerminal(rect, "right"));
    expect(route.from.at).toMatchObject({ x: 200, y: 50 });
    expect(route.to.at).toMatchObject({ x: 400, y: 50 });
    expect(route.to.out).toEqual({ x: -1, y: 0 });
  });

  test("an anchor is carried onto the outline its item's shape draws", () => {
    const corner = { x: 1, y: 1 };
    const onRect = edgeRoute(rect, ellipse, edge({ fromAnchor: corner })).from.at;
    expect(onRect).toMatchObject({ x: 200, y: 100 });
    const onEllipse = edgeRoute(rect, ellipse, edge({ toAnchor: corner })).to.at;
    // On the ellipse: ((x - cx) / a)² + ((y - cy) / b)² = 1.
    expect(((onEllipse.x - 500) / 100) ** 2 + ((onEllipse.y - 50) / 50) ** 2).toBeCloseTo(1, 6);
    const onDiamond = edgeRoute(diamond, rect, edge({ fromNode: "d", fromAnchor: corner })).from.at;
    expect(Math.abs(onDiamond.x - 100) / 100 + Math.abs(onDiamond.y - 350) / 50).toBeCloseTo(1, 6);
  });

  test("a drop's anchor, carried onto the outline, lands where it was dropped on it", () => {
    const anchor = anchorNear(rect, { x: 50, y: 0 });
    expect(anchor).toEqual({ x: 0.25, y: 0 });
    const placed = withEnd(edge(), "from", { anchor });
    expect(placed).toMatchObject({ fromAnchor: anchor, fromSide: "top" });
    expect(edgeRoute(rect, ellipse, placed).from.at).toMatchObject({ x: 50, y: 0 });
  });

  test("an end placed at a side drops its anchor, and one set supersedes a value kb could not read", () => {
    const odd = parseCanvasDoc({
      nodes: [],
      edges: [{ id: "x", fromNode: "r", toNode: "e", fromAnchor: { x: 3, y: 0 } }],
    }).edges[0] as CanvasEdge;
    expect(odd.extra).toEqual({ fromAnchor: { x: 3, y: 0 } });
    const placed = withEnd(odd, "from", { side: "bottom" });
    expect(placed.extra).toBeUndefined();
    expect(placed.fromAnchor).toBeUndefined();
    expect(placed.fromSide).toBe("bottom");
  });
});

describe("routes", () => {
  test("a straight route runs from end to end", () => {
    const route = edgeRoute(rect, ellipse, edge({ route: "straight" }));
    expect(route.path).toEqual([
      ["M", 200, 50],
      ["L", 400, 50],
    ]);
  });

  test("an arc bows its bend to the left of the way it runs", () => {
    const route = edgeRoute(rect, ellipse, edge({ route: "arc", bend: 30 }));
    // Running right along y = 50 with y down the page, left is up: y below 50.
    expect(routeMidpoint(route).y).toBeCloseTo(20, 0);
    const right = edgeRoute(rect, ellipse, edge({ route: "arc", bend: -30 }));
    expect(routeMidpoint(right).y).toBeCloseTo(80, 0);
  });

  test("an elbow runs along the axes only, its middle run moved by its bend", () => {
    const to: CanvasNode = { ...ellipse, y: 200 };
    const route = edgeRoute(rect, to, edge({ route: "elbow", bend: 20 }));
    const points = outlinePoints(route.path);
    for (let i = 1; i < points.length; i++) {
      const [ax = 0, ay = 0] = points[i - 1] ?? [];
      const [bx = 0, by = 0] = points[i] ?? [];
      expect(ax === bx || ay === by).toBe(true);
    }
    expect(points[1]?.[0]).toBe(320);
  });

  test("a route climbs from one end's height to the other's, level at each end", () => {
    const raised: CanvasNode = { ...ellipse, z: 60 };
    const points = routePoints(edgeRoute(rect, raised, edge({ route: "straight" })));
    expect(points[0]?.z).toBe(0);
    expect(points.at(-1)?.z).toBe(60);
  });

  test("a route set back to the curve, and no bend, is written as no field", () => {
    const bent = withRoute(edge(), { route: "arc", bend: 12 });
    expect(bent).toMatchObject({ route: "arc", bend: 12 });
    const back = withRoute(bent, { route: "curve", bend: undefined });
    expect(back).toEqual(edge());
  });
});

describe("heads", () => {
  test("JSON Canvas's defaults: bare leaving, an arrow arriving", () => {
    expect(headOf(edge(), "from")).toBeNull();
    expect(headOf(edge(), "to")).toBe("arrow");
    expect(headOf(edge({ toEnd: "none", toHead: "dot" }), "to")).toBeNull();
    expect(headOf(edge({ fromEnd: "arrow", fromHead: "diamond" }), "from")).toBe("diamond");
  });

  test("a head is written as JSON Canvas's coarse end and kb's kind, a default as no field", () => {
    const dotted = withHead(edge(), "from", "dot");
    expect(dotted).toMatchObject({ fromEnd: "arrow", fromHead: "dot" });
    expect(withHead(dotted, "from", null)).toEqual(edge());
    expect(withHead(edge(), "to", null)).toMatchObject({ toEnd: "none" });
    expect(withHead(edge({ toHead: "bar" }), "to", "arrow")).toEqual(edge());
  });

  test("a head's tip is on its end, pointing the way the route runs into it", () => {
    const route = edgeRoute(rect, ellipse, edge({ route: "straight" }));
    const head = edgeHead(edge({ route: "straight" }), route, "to", 10);
    expect(head?.kind).toBe("arrow");
    expect(head?.filled).toBe(true);
    expect(head?.path[0]).toEqual(["M", 400, 50]);
    const back = outlinePoints(head?.path ?? []).map(([x]) => x);
    expect(Math.min(...back)).toBeCloseTo(390, 6);
    const open = edgeHead(edge({ route: "straight", toHead: "open" }), route, "to", 10);
    expect(open?.filled).toBe(false);
  });
});

describe("the format", () => {
  test("every edge field round-trips, and what kb cannot read in them stays", () => {
    const raw = {
      nodes: [],
      edges: [
        {
          id: "x",
          fromNode: "r",
          toNode: "e",
          fromSide: "top",
          fromAnchor: { x: 0.25, y: 0 },
          toAnchor: { x: 0.5, y: 1, z: 2 },
          route: "elbow",
          bend: -12.5,
          fromEnd: "arrow",
          fromHead: "diamond",
          toHead: "spiral",
          style: { dash: "dotted", size: "xl", opacity: 0.5, wobble: 2 },
        },
      ],
    };
    const doc: CanvasDoc = parseCanvasDoc(raw);
    expect(doc.edges[0]).toMatchObject({
      fromAnchor: { x: 0.25, y: 0 },
      route: "elbow",
      bend: -12.5,
      fromHead: "diamond",
      style: { dash: "dotted", size: "xl", opacity: 0.5 },
    });
    expect(doc.edges[0]?.toHead).toBeUndefined();
    expect(JSON.parse(stringifyCanvasDoc(doc))).toEqual(raw);
  });

  test("connect writes the ends, route, heads and looks it is given", () => {
    const doc: CanvasDoc = { nodes: [rect, ellipse], edges: [] };
    const { edge: made } = connectItems(doc, {
      id: "x",
      bindingId: "k",
      from: "r",
      to: "e",
      toAnchor: { x: 0, y: 0.2 },
      route: "arc",
      bend: 10,
      fromHead: "bar",
      toHead: null,
      color: "pink",
      style: { dash: "dashed" },
    });
    expect(made).toMatchObject({
      fromSide: "right",
      toAnchor: { x: 0, y: 0.2 },
      toSide: "left",
      route: "arc",
      bend: 10,
      fromEnd: "arrow",
      fromHead: "bar",
      toEnd: "none",
      color: "pink",
      style: { dash: "dashed" },
    });
    expect(made.toHead).toBeUndefined();
  });
});
