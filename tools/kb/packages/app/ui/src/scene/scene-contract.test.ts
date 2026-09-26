/**
 * The scene contract: what every `SceneHandle` promises (`@/scene/host`,
 * DESIGN-UI.md → The lab), proved over every registered scene — each lab
 * study in `LAB_STUDIES` and the 3D graph. A new study joins by being
 * registered; a promise one scene keeps and another breaks goes red here.
 *
 * - disposing leaves no live renderer, no loop and no canvas;
 * - a hidden scene draws nothing;
 * - under reduced motion no animation loop runs;
 * - the device pixel ratio never exceeds 2, whatever the display's;
 * - a scene whose start fails gives its stage back.
 *
 * happy-dom has no GPU, so three's renderer and post chain are stand-ins that
 * count what they are asked to do; every other three class, every TSL node
 * graph and every scene's own code is the real thing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { LAB_STUDIES } from "@/components/lab/studies";
import type { LabSceneInit } from "@/components/lab/kit/contract";
import type { LensEdge, LensNode } from "@/lib/graph-lens";
import { TIMING_FALLBACK } from "@/lib/timing";
import type { SceneHandle } from "@/scene/host";
import type { ScenePalette } from "@/scene/palette";
import type * as ThreeWebGpu from "three/webgpu";

const gpu = vi.hoisted(() => {
  class FakePost {
    renders = 0;
    outputNode: unknown = null;
    outputColorTransform = true;
    needsUpdate = false;
    constructor(renderer: { post?: FakePost }) {
      renderer.post = this;
    }
    render() {
      if (gpu.failRender) throw new Error("shader compile failed");
      this.renders++;
    }
    dispose() {}
  }
  class FakeRenderer {
    domElement: HTMLCanvasElement = document.createElement("canvas");
    backend = { isWebGPUBackend: true };
    shadowMap = { enabled: false, type: 0 };
    toneMapping = 0;
    pixelRatio = 1;
    loop: ((now: number) => void) | null = null;
    post?: FakePost;
    constructor() {
      gpu.live.add(this);
      gpu.last = this;
    }
    init() {
      return Promise.resolve(this);
    }
    setPixelRatio(ratio: number) {
      this.pixelRatio = ratio;
    }
    getPixelRatio() {
      return this.pixelRatio;
    }
    setSize() {}
    setAnimationLoop(loop: ((now: number) => void) | null) {
      this.loop = loop;
      return Promise.resolve();
    }
    compileAsync() {
      return Promise.resolve();
    }
    compute() {}
    dispose() {
      gpu.live.delete(this);
    }
  }
  return {
    FakeRenderer,
    FakePost,
    live: new Set<InstanceType<typeof FakeRenderer>>(),
    last: null as InstanceType<typeof FakeRenderer> | null,
    failRender: false,
  };
});

vi.mock("three/webgpu", async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeWebGpu>()),
  WebGPURenderer: gpu.FakeRenderer,
  PostProcessing: gpu.FakePost,
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

/** Every registered scene: the lab's studies, and the 3D graph. */
const SCENES: readonly (readonly [string, Mount])[] = [
  ...Object.entries(LAB_STUDIES).map(([id, study]): readonly [string, Mount] => [
    `lab study ${id}`,
    async (host, reduced) => (await study.load())(host, labInit(reduced)),
  ]),
  [
    "3D graph",
    async (host, reduced) => {
      const { mountForce3d } = await import("@/components/graph/force3d-scene");
      return mountForce3d(host, {
        nodes: lensNodes,
        edges: lensEdges,
        settings: {
          spread: 150,
          linkDistance: 60,
          curvedLinks: false,
          autorotate: true,
          showLabels: true,
          labelTopN: 4,
          nodeLook: "matte",
          linkStyle: "lines",
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
function tickLoop(renderer: InstanceType<typeof gpu.FakeRenderer>, n: number): void {
  for (let i = 0; i < n; i++) {
    clock += 16;
    renderer.loop?.(clock);
  }
}
/** The renderer the scene just mounted made. */
function latest(): InstanceType<typeof gpu.FakeRenderer> {
  if (gpu.last === null) throw new Error("no renderer was made");
  return gpu.last;
}
const renders = (renderer: InstanceType<typeof gpu.FakeRenderer>) => renderer.post?.renders ?? 0;

function fake2d(canvas: HTMLCanvasElement) {
  const gradient = { addColorStop: () => {} };
  return new Proxy(
    { canvas, measureText: (text: string) => ({ width: text.length * 6 }) },
    {
      get: (target, key) =>
        key in target
          ? target[key as keyof typeof target]
          : key === "createRadialGradient" || key === "createLinearGradient"
            ? () => gradient
            : typeof key === "string" && /^[a-z]+[A-Z]|^(fill|stroke|scale|save|restore)/.test(key)
              ? () => {}
              : undefined,
      set: () => true,
    },
  );
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
    const canvasProto = dom.HTMLCanvasElement.prototype as unknown as {
      getContext: (this: HTMLCanvasElement, kind: string) => unknown;
    };
    canvasProto.getContext = function getContext(kind: string) {
      return kind === "2d" ? fake2d(this) : null;
    };
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
