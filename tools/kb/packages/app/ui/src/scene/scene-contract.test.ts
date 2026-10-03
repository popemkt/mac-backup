/**
 * The scene contract: what every `SceneHandle` promises (`@/scene/host`,
 * DESIGN-UI.md → The lab), proved over every registered scene — each lab
 * study in `LAB_STUDIES`, the 3D graph in every theme and the 3D canvas. A new study joins by being
 * registered; a promise one scene keeps and another breaks goes red here.
 *
 * - disposing leaves no live renderer, no loop and no canvas;
 * - a hidden scene draws nothing;
 * - under reduced motion no animation loop runs;
 * - the device pixel ratio never exceeds 2, whatever the display's;
 * - a scene whose start fails gives its stage back.
 *
 * happy-dom has no GPU, so three's renderer and post chain are the stand-ins
 * in `@/test-support/fake-gpu`, which count what they are asked to do; every
 * other three class, every TSL node graph and every scene's own code is the
 * real thing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { LAB_STUDIES } from "@/components/lab/studies";
import type { LabSceneInit } from "@/components/lab/kit/contract";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { LENS_THEMES } from "@kb/views";
import { TIMING_FALLBACK } from "@/lib/timing";
import type { SceneHandle } from "@/scene/host";
import type { ScenePalette } from "@/scene/palette";
import { fakeCanvasContexts, gpu, renders, type FakeRenderer } from "@/test-support/fake-gpu";
import { BufferGeometry, Material, Object3D, Sprite } from "three/webgpu";
import type * as ThreeWebGpu from "three/webgpu";

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  ...(await import("@/test-support/fake-gpu")).FAKE_WEBGPU,
}));

const palette: ScenePalette = {
  ground: "rgb(20, 20, 30)",
  edge: "rgb(10, 10, 16)",
  hue: "rgb(90, 80, 160)",
  ink: "rgb(230, 230, 240)",
  accent: "rgb(210, 140, 40)",
};

const lensNodes: LensNode[] = ["a", "b", "c", "d"].map((id, i) => ({
  id,
  label: `node ${id}`,
  color: "#6366f1",
  size: 3 + i,
  clusterKey: "r",
  tags: [],
  degree: i,
}));
const lensEdges: LensEdge[] = [
  { source: "a", target: "b", kind: "mention", weight: 1 },
  { source: "b", target: "c", kind: "mention", weight: 2 },
];

function labInit(reducedMotion: boolean): LabSceneInit {
  return {
    palette,
    dark: true,
    reducedMotion,
    timing: TIMING_FALLBACK,
    values: {},
    graph: {
      nodes: lensNodes.map((n, i) => ({
        id: n.id,
        label: n.label,
        degree: n.degree,
        cluster: "r",
        recency: i / 4,
        glint: i === 3,
      })),
      edges: lensEdges.map((e) => ({ source: e.source, target: e.target })),
    },
    onHover: () => {},
    onOpen: () => {},
  };
}

type Mount = (host: HTMLElement, reducedMotion: boolean) => Promise<SceneHandle>;

/** Every registered scene: the lab's studies, the 3D graph and the 3D canvas. */
const SCENES: readonly (readonly [string, Mount])[] = [
  ...Object.entries(LAB_STUDIES).map(([id, study]): readonly [string, Mount] => [
    `lab study ${id}`,
    async (host, reduced) => (await study.load())(host, labInit(reduced)),
  ]),
  ...LENS_THEMES.map((theme): readonly [string, Mount] => [
    `3D graph, ${theme} theme`,
    async (host, reduced) => {
      const { mountForce3d } = await import("@/components/graph/force3d-scene");
      return mountForce3d(host, {
        nodes: lensNodes,
        edges: lensEdges,
        settings: {
          spread: 150,
          linkDistance: 60,
          autorotate: true,
          showLabels: true,
          labelTopN: 4,
          theme,
          linkStyle: "straight",
        },
        emphasis: { selectedNodeId: null },
        palette,
        link: "rgba(230, 230, 240, 0.3)",
        dark: true,
        reducedMotion: reduced,
        timing: TIMING_FALLBACK,
        onSelect: () => {},
        onOpen: () => {},
        onHover: () => {},
      });
    },
  ]),
  [
    "3D canvas",
    async (host, reduced) => {
      const { mountCanvasScene } = await import("@/components/canvas/canvas-scene");
      const { CanvasCameraRig } = await import("@/components/canvas/canvas-camera-rig");
      const view = { x: 0, y: 0, z: 0, zoom: 1, yaw: -0.2, pitch: 0.5, fov: 34 };
      const rig = new CanvasCameraRig(view, TIMING_FALLBACK, reduced);
      const scene = await mountCanvasScene(host, {
        rig,
        content: {
          doc: {
            nodes: [
              { id: "a", type: "text", text: "a card", x: 0, y: 0, width: 200, height: 80 },
              {
                id: "b",
                type: "text",
                text: "raised",
                x: 260,
                y: 40,
                width: 200,
                height: 80,
                z: 90,
              },
            ],
            edges: [{ id: "e", fromNode: "a", toNode: "b", toEnd: "arrow" }],
          },
          nodes: new Map(),
          // A selection, so the gizmo stands on it and is drawn (and given back) too.
          selection: { nodeIds: new Set(["a"]), edgeIds: new Set() },
        },
        look: {
          face: "rgb(20, 20, 30)",
          ink: "rgb(230, 230, 240)",
          primary: "rgb(210, 140, 40)",
          danger: "rgb(220, 60, 60)",
          presets: {},
          font: "sans-serif",
          body: 14.5,
          ui: 13,
          label: 11,
          radius: 18,
          shapeRadius: 8,
        },
        palette,
        dark: true,
        timing: TIMING_FALLBACK,
        reducedMotion: reduced,
        gizmo: { mode: "rotate", space: "local" },
      });
      // A handover in flight: the scene must still stop, hide and hold still on cue.
      rig.flyTo({ ...view, yaw: 0.4 });
      return scene;
    },
  ],
];

// --- a document with a frame queue we drive ---------------------------------

let frameQueue: ((now: number) => void)[] = [];
let clock = 0;
/** Run every requested frame (and any they request), up to a bound. */
function flushFrames(limit = 20): void {
  for (let i = 0; i < limit && frameQueue.length > 0; i++) {
    const due = frameQueue;
    frameQueue = [];
    clock += 16;
    for (const run of due) run(clock);
  }
}
/** Step the animation loop, if one is running, `n` times. */
function tickLoop(renderer: FakeRenderer, n: number): void {
  for (let i = 0; i < n; i++) {
    clock += 16;
    renderer.loop?.(clock);
  }
}
/** The renderer the scene just mounted made. */
function latest(): FakeRenderer {
  if (gpu.last === null) throw new Error("no renderer was made");
  return gpu.last;
}

describe("scene contract", () => {
  let dom: Window;
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
  const hosts: HTMLElement[] = [];

  beforeAll(() => {
    dom = new Window();
    const globals: Record<string, unknown> = {
      window: dom,
      document: dom.document,
      HTMLElement: dom.HTMLElement,
      getComputedStyle: dom.getComputedStyle.bind(dom),
      requestAnimationFrame: (run: (now: number) => void) => {
        frameQueue.push(run);
        return frameQueue.length;
      },
      cancelAnimationFrame: () => {
        frameQueue = [];
      },
    };
    for (const [key, value] of Object.entries(globals)) {
      saved.set(key, g[key]);
      g[key] = value;
    }
    fakeCanvasContexts(dom.HTMLCanvasElement.prototype);
  });

  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  });

  afterEach(() => {
    gpu.failRender = false;
    frameQueue = [];
    for (const host of hosts.splice(0)) host.remove();
  });

  const host = (): HTMLElement => {
    const el = dom.document.createElement("div") as unknown as HTMLElement;
    dom.document.body.appendChild(el as never);
    hosts.push(el);
    return el;
  };

  describe.each(SCENES)("%s", (_name, mount) => {
    it("disposing leaves no live renderer, loop or canvas", async () => {
      const el = host();
      const scene = await mount(el, false);
      const renderer = latest();
      scene.setRunning(true);
      tickLoop(renderer, 3);
      scene.dispose();
      expect(gpu.live.has(renderer)).toBe(false);
      expect(renderer.loop).toBeNull();
      expect(el.querySelector("canvas")).toBeNull();
      const drawn = renders(renderer);
      flushFrames();
      expect(renders(renderer)).toBe(drawn);
    });

    it("disposing gives back every geometry and material it drew with", async () => {
      const added = vi.spyOn(Object3D.prototype, "add");
      const geometries = vi.spyOn(BufferGeometry.prototype, "dispose");
      const materials = vi.spyOn(Material.prototype, "dispose");
      const scene = await mount(host(), false);
      scene.setRunning(true);
      scene.dispose();
      const disposed = new Set<unknown>([...geometries.mock.contexts, ...materials.mock.contexts]);
      const leaked: string[] = [];
      const drawn = added.mock.calls.flat().filter((one) => one instanceof Object3D);
      for (const root of drawn) {
        root.traverse((object: Object3D & { geometry?: unknown; material?: unknown }) => {
          // Every sprite shares three's one quad (`scene/gpu/dispose`), which is never freed.
          if (object.geometry !== undefined && !(object instanceof Sprite)) {
            if (!disposed.has(object.geometry)) leaked.push(`${object.type} geometry`);
          }
          const list = Array.isArray(object.material) ? object.material : [object.material];
          for (const one of list) {
            if (one !== undefined && !disposed.has(one)) leaked.push(`${object.type} material`);
          }
        });
      }
      added.mockRestore();
      geometries.mockRestore();
      materials.mockRestore();
      expect(leaked).toEqual([]);
    });

    it("draws nothing while hidden", async () => {
      const scene = await mount(host(), false);
      const renderer = latest();
      scene.setRunning(true);
      flushFrames();
      tickLoop(renderer, 3);
      scene.setRunning(false);
      expect(renderer.loop).toBeNull();
      const drawn = renders(renderer);
      scene.resize(640, 480);
      flushFrames();
      tickLoop(renderer, 3);
      expect(renders(renderer)).toBe(drawn);
      scene.dispose();
    });

    it("runs no animation loop under reduced motion", async () => {
      const scene = await mount(host(), false);
      const renderer = latest();
      scene.setRunning(true);
      flushFrames();
      scene.setReducedMotion(true);
      flushFrames();
      expect(renderer.loop).toBeNull();
      // A change draws a still, once, and starts nothing.
      const drawn = renders(renderer);
      scene.resize(700, 500);
      flushFrames();
      expect(renderer.loop).toBeNull();
      expect(renders(renderer) - drawn).toBeLessThanOrEqual(1);
      scene.dispose();
    });

    it("starts still when mounted under reduced motion", async () => {
      const scene = await mount(host(), true);
      const renderer = latest();
      scene.setRunning(true);
      flushFrames();
      expect(renderer.loop).toBeNull();
      scene.dispose();
    });

    it("never exceeds a device pixel ratio of 2", async () => {
      const scene = await mount(host(), false);
      const renderer = latest();
      (dom as unknown as { devicePixelRatio: number }).devicePixelRatio = 3;
      scene.resize(800, 600);
      expect(renderer.pixelRatio).toBeGreaterThan(0);
      expect(renderer.pixelRatio).toBeLessThanOrEqual(2);
      (dom as unknown as { devicePixelRatio: number }).devicePixelRatio = 1;
      scene.dispose();
    });

    it("gives its stage back when its start fails", async () => {
      const before = gpu.live.size;
      gpu.failRender = true;
      await expect(mount(host(), false)).rejects.toThrow("shader compile failed");
      expect(gpu.live.size).toBe(before);
    });
  });
});
