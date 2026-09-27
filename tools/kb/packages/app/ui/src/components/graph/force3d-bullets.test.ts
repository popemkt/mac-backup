/**
 * The bullet theme's node layer: each node sampling its own atlas cell
 * (`lib/bullet-atlas`), picked and labelled by as far as its bullet
 * shows, restyled in place when a bullet changes (a collapse), and giving
 * its atlas back when it is replaced.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { CanvasTexture, Color } from "three/webgpu";
import { uniform } from "three/tsl";
import { BULLET_GEOMETRY, bulletAppearance, bulletExtent } from "@/lib/bullet-mode";
import { EmphasisFade } from "@/lib/graph-fade";
import type { LensNode } from "@/lib/graph-lens";
import { topologyOf } from "./force3d-emphasis";
import { BulletAtlas } from "@/lib/bullet-atlas";
import { bulletLayer } from "./force3d-bullets";
import { GRAPH_THEMES } from "./graph-themes";

const bullet = (hasChildren: boolean, collapsed: boolean, tagColors: string[] = []) =>
  bulletAppearance({
    hasChildren,
    typeRefs: [],
    tagNames: [],
    isSys: false,
    collapsed,
    childCount: hasChildren ? 2 : 0,
    tagColors,
  });

function node(id: string, b = bullet(false, false)): LensNode {
  return { id, label: id, color: "#888", size: 3, clusterKey: "r", tags: [], degree: 1, bullet: b };
}

const PALETTE = { ground: "#fff", edge: "#fff", hue: "#888", ink: "#111", accent: "#f80" };
const colors = () => ({
  ground: uniform(new Color()),
  edge: uniform(new Color()),
  hue: uniform(new Color()),
  ink: uniform(new Color()),
  accent: uniform(new Color()),
});
const fades = (n: number) => ({
  dim: new EmphasisFade(n, 0.2),
  glow: new EmphasisFade(n, 0.2, 0),
  lift: new EmphasisFade(n, 0.2, 0),
  focus: new EmphasisFade(n, 0.2, 0),
});

describe("the 3D bullet layer", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  beforeAll(() => {
    const dom = new Window();
    const globals = {
      window: dom,
      document: dom.document,
      getComputedStyle: dom.getComputedStyle.bind(dom),
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  it("is picked by as far as each bullet shows, and follows a collapse in place", () => {
    const leaf = node("leaf");
    const open = node("parent", bullet(true, false));
    const topology = topologyOf([leaf, open], []);
    const layer = bulletLayer({
      topology,
      colors: colors(),
      fades: fades(2),
      theme: GRAPH_THEMES.bullet,
      palette: PALETTE,
    });
    const dot = bulletExtent(bullet(true, false));
    const halo = BULLET_GEOMETRY.box / 2 - BULLET_GEOMETRY.haloInset;
    const expanded = layer.radius(1);
    layer.restyle([leaf, node("parent", bullet(true, true))]);
    expect(layer.radius(1) / expanded).toBeCloseTo(halo / dot, 5);
    layer.dispose();
  });

  it("repaints its atlas only when a bullet changed, and gives it back when disposed", () => {
    const paint = vi.spyOn(BulletAtlas.prototype, "paint");
    const nodes = [node("a"), node("b", bullet(true, true))];
    const layer = bulletLayer({
      topology: topologyOf(nodes, []),
      colors: colors(),
      fades: fades(2),
      theme: GRAPH_THEMES.bullet,
      palette: PALETTE,
    });
    const painted = paint.mock.calls.length;
    expect(painted).toBeGreaterThan(0);
    layer.restyle(nodes.map((n) => ({ ...n, label: `${n.label}!` })));
    expect(paint.mock.calls.length).toBe(painted);
    layer.restyle([node("a"), node("b", bullet(true, false))]);
    expect(paint.mock.calls.length).toBe(painted + 1);
    const dispose = vi.spyOn(CanvasTexture.prototype, "dispose");
    layer.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    paint.mockRestore();
    dispose.mockRestore();
  });
});
