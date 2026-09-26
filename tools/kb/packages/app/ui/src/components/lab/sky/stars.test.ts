import { describe, expect, it } from "vitest";
import { Color } from "three/webgpu";
import { float, uniform } from "three/tsl";
import { TIMING_FALLBACK } from "@/lib/timing";
import type { LabGraph } from "@/components/lab/lab-graph";
import { Entrance } from "@/components/lab/kit/entrance";
import { NodeStars } from "./stars";

const colors = {
  ground: uniform(new Color()),
  edge: uniform(new Color()),
  hue: uniform(new Color()),
  ink: uniform(new Color()),
  accent: uniform(new Color()),
};

const node = (id: string) => ({
  id,
  label: id,
  degree: 1,
  cluster: "c",
  recency: 0.5,
  glint: false,
});
const graph: LabGraph = {
  nodes: [node("a"), node("b")],
  edges: [{ source: "a", target: "b" }],
};

function stars(): NodeStars {
  const u = {
    time: float(0),
    twinkle: float(0),
    hover: float(-1),
    spikes: float(1),
    lines: float(0),
  };
  return new NodeStars(colors, u, graph, new Entrance(TIMING_FALLBACK));
}

describe("the Sky's constellation lines", () => {
  it("under reduced motion, are hidden on the same draw that lets them go", () => {
    const s = stars();
    s.constellation(0);
    expect(s.lines.visible).toBe(true);
    expect(s.fadeLines(0, 8, 0, true)).toBe(1);
    s.constellation(-1);
    expect(s.fadeLines(1, 8, 0, true)).toBe(0);
    expect(s.lines.visible).toBe(false);
  });

  it("with motion, stay drawn while they fade out, then hide", () => {
    const s = stars();
    s.constellation(0);
    s.constellation(-1);
    const fading = s.fadeLines(1, 8, 1 / 60, false);
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(s.lines.visible).toBe(true);
    let opacity = fading;
    for (let i = 0; i < 120; i++) opacity = s.fadeLines(opacity, 8, 1 / 60, false);
    expect(opacity).toBe(0);
    expect(s.lines.visible).toBe(false);
  });
});
