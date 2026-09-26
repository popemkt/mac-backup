/**
 * The 3D graph's drawn state keeps what a new look does not change: a look
 * or a link style redraws the layers in place, from the positions and the
 * arrival as they stand; only a new node set lays the graph out and brings it
 * in again. The stage is a stand-in over real three objects — no GPU.
 */
import { describe, expect, it } from "vitest";
import { Color, PerspectiveCamera, Scene } from "three/webgpu";
import { uniform } from "three/tsl";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { TIMING_FALLBACK } from "@/lib/timing";
import type { SceneStage } from "@/scene/gpu/stage";
import { GraphLayers, type Force3dSettings } from "./force3d-layers";

const node = (id: string, degree: number): LensNode => ({
  id,
  label: id,
  color: "#6366f1",
  size: 3,
  clusterKey: "r",
  tags: [],
  degree,
});
const NODES = ["hub", "a", "b", "c", "d"].map((id, i) => node(id, i === 0 ? 4 : 1));
const EDGES: LensEdge[] = ["a", "b", "c", "d"].map((id) => ({
  source: "hub",
  target: id,
  kind: "child",
  weight: 1,
}));

const SETTINGS: Force3dSettings = {
  spread: 150,
  linkDistance: 60,
  curvedLinks: false,
  autorotate: false,
  showLabels: false,
  labelTopN: 0,
  nodeLook: "matte",
  linkStyle: "lines",
};

function stage(): SceneStage {
  const colors = {
    ground: uniform(new Color()),
    edge: uniform(new Color()),
    hue: uniform(new Color()),
    ink: uniform(new Color()),
    accent: uniform(new Color()),
  };
  const fake = {
    scene: new Scene(),
    camera: new PerspectiveCamera(50, 1.5, 1, 1000),
    colors,
    renderer: { domElement: { clientHeight: 600 } },
    reduced: () => false,
    invalidate: () => {},
  };
  return fake as unknown as SceneStage;
}

function layers(): GraphLayers {
  return new GraphLayers(stage(), {
    nodes: NODES,
    edges: EDGES,
    settings: SETTINGS,
    emphasis: { selectedNodeId: null },
    palette: { ground: "#000", edge: "#000", hue: "#888", ink: "#fff", accent: "#f80" },
    link: "rgba(255, 255, 255, 0.3)",
    timing: TIMING_FALLBACK,
  });
}

const viewport = { width: 900, height: 600 };

describe("3D graph layers", () => {
  it("redraws a new look or link style in place: nothing moves, nothing arrives again", () => {
    const graph = layers();
    const camera = new PerspectiveCamera(50, 1.5, 1, 1000);
    // Part-way through the arrival.
    graph.frame(0.05, camera, viewport);
    const positions = graph.positions;
    const where = [...positions];
    const arrived = [...graph.arrived()];
    expect(arrived.some((v) => v > 0 && v < 1)).toBe(true);
    for (const change of [
      { nodeLook: "glass" as const },
      { linkStyle: "flow" as const },
      { curvedLinks: true },
    ]) {
      graph.setSettings({ ...graph.settings, ...change });
      expect(graph.positions).toBe(positions);
      expect([...graph.positions]).toEqual(where);
      expect([...graph.arrived()]).toEqual(arrived);
    }
    graph.dispose();
  });

  it("carries the flow's dashes across a new look and a new curve", () => {
    const graph = layers();
    const camera = new PerspectiveCamera(50, 1.5, 1, 1000);
    graph.setSettings({ ...graph.settings, linkStyle: "flow" });
    for (let i = 0; i < 5; i++) graph.frame(0.05, camera, viewport);
    const phase = graph.motion().flowPhase;
    expect(phase).toBeGreaterThan(0);
    graph.setSettings({ ...graph.settings, nodeLook: "cel" });
    expect(graph.motion().flowPhase).toBe(phase);
    graph.setSettings({ ...graph.settings, curvedLinks: true });
    expect(graph.motion().flowPhase).toBe(phase);
    graph.dispose();
  });

  it("keeps a selection's particles showing and moving across a new look and a new curve", () => {
    const graph = layers();
    const camera = new PerspectiveCamera(50, 1.5, 1, 1000);
    graph.emphasis = { selectedNodeId: "hub" };
    graph.refresh();
    for (let i = 0; i < 5; i++) graph.frame(0.05, camera, viewport);
    const before = graph.motion().particles;
    expect(before?.showing ?? 0).toBeGreaterThan(0);
    expect(before?.phase ?? 0).toBeGreaterThan(0);
    graph.setSettings({ ...graph.settings, nodeLook: "glass" });
    expect(graph.motion().particles).toEqual(before);
    graph.setSettings({ ...graph.settings, curvedLinks: true });
    expect(graph.motion().particles).toEqual(before);
    graph.frame(0.016, camera, viewport);
    expect(graph.particleCount()).toBeGreaterThan(0);
    graph.dispose();
  });

  it("lays out and arrives again for a new node set", () => {
    const graph = layers();
    const camera = new PerspectiveCamera(50, 1.5, 1, 1000);
    for (let i = 0; i < 40; i++) graph.frame(0.05, camera, viewport);
    expect([...graph.arrived()].every((v) => v === 1)).toBe(true);
    graph.setGraph([...NODES, node("e", 0)], EDGES);
    expect([...graph.arrived()].every((v) => v === 0)).toBe(true);
    graph.dispose();
  });
});
