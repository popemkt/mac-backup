/**
 * Everywhere a press reaches on the canvas is where a script's drawing is
 * masked off (`pressRegions`): the 2D chrome is drawn by the geometry the
 * reach is read from (`canvas-chrome`), so no handle stands past it, and
 * each projection's regions hold its items, edges, labels and own handles.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { edgeRoute, routeMidpoint, type CanvasDoc, type CanvasNode } from "@kb/canvas";
import { present } from "@kb/model";
import { projectPoint, screenBounds, viewOfPan, type ScreenRect } from "./canvas-camera";
import { chromeReach, labelChip, labelReach, LABEL_FIELD } from "./canvas-chrome";
import { CanvasPorts } from "./canvas-ports";
import { canvasProjection } from "./canvas-projections";
import { CanvasResizeHandles } from "./canvas-resize-handles";
import { pressRegions } from "./canvas-visible";

const noop = () => {};

/** Each element's inline style in `html`: its lengths in px, by property. */
function stylesOf(html: string): Record<string, number>[] {
  return [...html.matchAll(/style="([^"]*)"/g)].map(([, style = ""]) =>
    Object.fromEntries(
      style
        .split(";")
        .map((part) => part.split(":").map((s) => s.trim()))
        .filter(
          (pair): pair is [string, string] => pair.length === 2 && (pair[1] ?? "").endsWith("px"),
        )
        .map(([key, value]) => [key, Number.parseFloat(value)]),
    ),
  );
}

/** How far past its face an element placed by `style` reaches, canvas units. */
function pastFace(style: Record<string, number>): number {
  const offsets = ["top", "bottom", "left", "right"].map((side) => -(style[side] ?? 0));
  // A port is centred on a side by its translate: it stands half its size past the face.
  return Math.max(...offsets, (style.width ?? 0) / 2);
}

/** The boxes among `regions`. */
const boxesOf = (regions: ReturnType<typeof pressRegions>): ScreenRect[] =>
  regions.flatMap((region) => ("box" in region ? [region.box] : []));

/** Whether `outer` holds `inner`. */
const holds = (outer: ScreenRect, inner: ScreenRect) =>
  outer.left <= inner.left &&
  outer.top <= inner.top &&
  outer.right >= inner.right &&
  outer.bottom >= inner.bottom;

describe("the 2D chrome stands within the reach it is read by", () => {
  it("ports, corner handles and the rotate handle reach no further than chromeReach", () => {
    const ports = stylesOf(renderToStaticMarkup(createElement(CanvasPorts, { onPortDown: noop })));
    expect(ports).toHaveLength(4);
    for (const port of ports) expect(pastFace(port)).toBeLessThanOrEqual(chromeReach(false));
    const handles = stylesOf(
      renderToStaticMarkup(
        createElement(CanvasResizeHandles, {
          selected: true,
          onResizeStart: noop,
          onRotateStart: noop,
        }),
      ),
    );
    expect(handles).toHaveLength(5);
    for (const handle of handles) expect(pastFace(handle)).toBeLessThanOrEqual(chromeReach(true));
    // The rotate handle is the furthest: the reach is no wider than it needs.
    expect(Math.max(...handles.map(pastFace))).toBe(chromeReach(true));
  });

  it("an edge's label, chip or field, stands within its label reach", () => {
    const reach = labelReach("a longer label");
    const chip = labelChip("a longer label");
    expect(chip.width / 2).toBeLessThanOrEqual(reach.halfWidth);
    expect(chip.height / 2).toBeLessThanOrEqual(reach.halfHeight);
    expect(LABEL_FIELD.width / 2).toBeLessThanOrEqual(reach.halfWidth);
    expect(LABEL_FIELD.height / 2).toBeLessThanOrEqual(reach.halfHeight);
  });
});

describe("pressRegions", () => {
  const size = { width: 800, height: 600 };
  const a: CanvasNode = { id: "a", type: "text", text: "a", x: 0, y: 0, width: 100, height: 50 };
  const b: CanvasNode = { id: "b", type: "text", text: "b", x: 300, y: 0, width: 100, height: 50 };
  const edge = { id: "e", fromNode: "a", toNode: "b", label: "goes" };
  const doc: CanvasDoc = { nodes: [a, b], edges: [edge] };
  const drawn = (view: Parameters<typeof screenBounds>[0], item: CanvasNode) =>
    present(screenBounds(view, size, item), `${item.id} is drawn`);

  it("in 2D, grows each item by its chrome at the zoom, and holds each edge's label", () => {
    const view = viewOfPan({ x: 50, y: 80 }, 2, size);
    const regions = pressRegions(doc, view, size, {
      chrome: canvasProjection("2d").chrome,
      selected: new Set(["a"]),
      own: [],
    });
    const [grownA, grownB, label] = boxesOf(regions);
    expect(drawn(view, a).top - (grownA?.top ?? 0)).toBeCloseTo(chromeReach(true) * 2);
    expect((grownB?.right ?? 0) - drawn(view, b).right).toBeCloseTo(chromeReach(false) * 2);
    const mid = present(
      projectPoint(view, size, { ...routeMidpoint(edgeRoute(a, b, edge)), z: 0 }),
      "the label's middle is drawn",
    );
    const reach = labelReach("goes");
    const chipAndField = {
      left: mid.x - reach.halfWidth * 2,
      top: mid.y - reach.halfHeight * 2,
      right: mid.x + reach.halfWidth * 2,
      bottom: mid.y + reach.halfHeight * 2,
    };
    expect(label !== undefined && holds(label, chipAndField)).toBe(true);
    expect(regions.filter((region) => "line" in region)).toHaveLength(1);
  });

  it("in 3D, draws no chrome round items or labels, and holds what its own handles reach", () => {
    const view = { x: 200, y: 25, z: 0, zoom: 1, yaw: 0.4, pitch: 0.6, fov: 34 };
    const gizmo = { left: 10, top: 20, right: 30, bottom: 40 };
    const regions = pressRegions(doc, view, size, {
      chrome: canvasProjection("3d").chrome,
      selected: new Set(["a"]),
      own: [gizmo],
    });
    expect(boxesOf(regions)).toEqual([drawn(view, a), drawn(view, b), gizmo]);
  });
});
