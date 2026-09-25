/**
 * 2D label avoidance reads the frame it draws, not the one before: sigma
 * announces a frame before it re-processes positions and rebuilds its camera
 * matrix, so the node boxes are sampled when the first label is placed. Here
 * the world moves between the announcement and the labels — a camera move
 * and a layout tick at once — and the label must avoid where the node *is*.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Settings } from "sigma/settings";
import type { GraphLabelBox } from "@/lib/graph-label-layout";
import { drawGraphHover, drawGraphLabel, resetGraphLabels, setGraphLabelInk } from "./sigma-labels";

type LabelData = Parameters<Settings["defaultDrawNodeLabel"]>[1];

function fakeContext(pass: "sigma-labels" | "sigma-hovers" = "sigma-labels") {
  const drawn: { text: string; x: number }[] = [];
  const canvas = {
    width: 800,
    height: 600,
    classList: { contains: (name: string) => name === pass },
  };
  const ctx = {
    canvas,
    font: "",
    fillStyle: "",
    strokeStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    lineWidth: 0,
    lineJoin: "",
    measureText: (text: string) => ({ width: text.length * 6 }),
    save: () => {},
    beginPath: () => {},
    arc: () => {},
    stroke: () => {},
    restore: () => {},
    strokeText: () => {},
    fillText: (text: string, x: number) => drawn.push({ text, x }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, canvas, drawn };
}

const settings = { labelSize: 12, labelFont: "sans-serif" } as unknown as Settings;

/** A world whose one blocking node moves with the layout and the camera. */
function world() {
  const state = { layoutX: 0, cameraX: 0 };
  const sample = (out: GraphLabelBox[]) => {
    // Viewport position = layout position shifted by the camera.
    const x = 300 + state.layoutX - state.cameraX;
    out.push({ x: x - 10, y: 290, width: 20, height: 20 });
  };
  return { state, sample };
}

function label(x: number): LabelData {
  return { x, y: 300, size: 4, label: "A label", color: "#000" };
}

describe("2D label placement samples the drawn frame", () => {
  setGraphLabelInk("#111", "#fff");
  const g = globalThis as Record<string, unknown>;
  beforeAll(() => {
    g.window = { devicePixelRatio: 1 };
  });
  afterAll(() => {
    delete g.window;
  });

  it("avoids the node where the frame draws it, after a camera move and a layout tick", () => {
    const { ctx, canvas, drawn } = fakeContext();
    const { state, sample } = world();
    // The frame is announced while the node still sits at x = 300…
    resetGraphLabels([canvas as unknown as HTMLCanvasElement], sample);
    // …then sigma processes: a layout tick moves the node right, the camera
    // pans left, and the node is drawn at x = 300 + 60 + 20 = 380.
    state.layoutX = 60;
    state.cameraX = -20;
    // A label for a node at 330 would sit on the right, over x 340–390,
    // which is where the moved node is: it must go to the left instead.
    drawGraphLabel(ctx, label(330), settings);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.x).toBeLessThan(330);
  });

  it("does not avoid where the node used to be (the stale frame)", () => {
    const { ctx, canvas, drawn } = fakeContext();
    const { state, sample } = world();
    resetGraphLabels([canvas as unknown as HTMLCanvasElement], sample);
    // The node leaves x = 300 before the labels are drawn.
    state.layoutX = 200;
    // A label right of a node at 270 covers 280–330: the old place, now empty.
    drawGraphLabel(ctx, label(270), settings);
    expect(drawn[0]?.x).toBeGreaterThan(270);
  });

  it("samples once per frame, and again on the next", () => {
    const { ctx, canvas } = fakeContext();
    let samples = 0;
    const counting = (out: GraphLabelBox[]) => {
      samples++;
      out.length = 0;
    };
    resetGraphLabels([canvas as unknown as HTMLCanvasElement], counting);
    drawGraphLabel(ctx, label(100), settings);
    drawGraphLabel(ctx, label(500), settings);
    expect(samples).toBe(1);
    resetGraphLabels([canvas as unknown as HTMLCanvasElement], counting);
    drawGraphLabel(ctx, label(100), settings);
    expect(samples).toBe(2);
  });

  it("keeps the hover label off other nodes after the label pass has drawn", () => {
    const labels = fakeContext("sigma-labels");
    const hovers = fakeContext("sigma-hovers");
    const { state, sample } = world();
    let samples = 0;
    const counting = (out: GraphLabelBox[]) => {
      samples++;
      sample(out);
    };
    // One frame, both canvases, as sigma-graph resets them in beforeRender.
    resetGraphLabels([labels.canvas, hovers.canvas] as unknown as HTMLCanvasElement[], counting);
    state.layoutX = 60;
    // Sigma's order: the label pass first (it samples the nodes)…
    drawGraphLabel(labels.ctx, label(100), settings);
    // …then the hover pass, whose right side would cover the node at 360.
    drawGraphHover(hovers.ctx, label(330), settings);
    expect(samples).toBe(1);
    expect(hovers.drawn).toHaveLength(1);
    expect(hovers.drawn[0]?.x).toBeLessThan(330);
  });

  it("always draws the hover label, even when no side is clear", () => {
    const hovers = fakeContext("sigma-hovers");
    resetGraphLabels([hovers.canvas] as unknown as HTMLCanvasElement[], (out) =>
      out.push({ x: 0, y: 0, width: 800, height: 600 }),
    );
    drawGraphHover(hovers.ctx, label(330), settings);
    expect(hovers.drawn).toHaveLength(1);
  });
});
