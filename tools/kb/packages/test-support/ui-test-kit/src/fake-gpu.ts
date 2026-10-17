/**
 * Stand-ins for the parts of three a unit run cannot have: happy-dom has no
 * GPU and no 2D canvas. A suite that mounts real scenes (the scene contract,
 * the canvas projection contract) swaps three's renderer and post chain for
 * these, which count what they are asked to do; every other three class,
 * every TSL node graph and every scene's own code stays the real thing.
 *
 * ```ts
 * vi.mock("three/webgpu", async (importOriginal) => ({
 *   ...(await importOriginal<typeof ThreeWebGpu>()),
 *   ...(await import("@kb/ui-test-kit")).FAKE_WEBGPU,
 * }));
 * ```
 */

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
  compute() {}
  dispose() {
    gpu.live.delete(this);
  }
}

export type { FakeRenderer };

/** What the stand-ins saw: the live renderers, the last one made, and a switch to fail the first frame. */
export const gpu = {
  live: new Set<FakeRenderer>(),
  last: null as FakeRenderer | null,
  failRender: false,
};

/** The `three/webgpu` exports a suite replaces. */
export const FAKE_WEBGPU = { WebGPURenderer: FakeRenderer, RenderPipeline: FakePost };

/** How many frames a stand-in renderer's post chain has drawn. */
export const renders = (renderer: FakeRenderer): number => renderer.post?.renders ?? 0;

/** A point a painted path passes through, in the context's own units (before any transform). */
type PaintedPoint = { readonly x: number; readonly y: number };

/**
 * What a stand-in 2D context was asked to paint since its canvas was last
 * cleared: each stroke with the colour, dash and width set for it and each
 * fill with its colour, with the points of the path it painted (curves
 * sampled), and each run of words with the colour, font, alignment and
 * baseline position set for it — what a contract reads a painted texture
 * back by.
 */
export type PaintedOp =
  | {
      readonly op: "stroke";
      readonly color: string;
      readonly pattern: readonly number[];
      readonly width: number;
      readonly points: readonly PaintedPoint[];
    }
  | { readonly op: "fill"; readonly color: string; readonly points: readonly PaintedPoint[] }
  | {
      readonly op: "text";
      readonly text: string;
      readonly color: string;
      readonly font: string;
      readonly align: string;
      readonly y: number;
    };

/** How many points a painted cubic is sampled at. */
const CURVE_SAMPLES = 12;

const PAINTED = new WeakMap<HTMLCanvasElement, PaintedOp[]>();

/** What `canvas` was asked to paint since it was last cleared (`PaintedOp`). */
export function paintedOps(canvas: HTMLCanvasElement): readonly PaintedOp[] {
  return PAINTED.get(canvas) ?? [];
}

/**
 * A 2D context that accepts every call and measures text at 6px a character,
 * enough for a scene to paint its textures (and read a blank glyph back),
 * and records what it strokes and the words it sets (`paintedOps`).
 */
const noop = () => {};

function fake2d(canvas: HTMLCanvasElement) {
  const gradient = { addColorStop: () => {} };
  const ops = PAINTED.get(canvas) ?? [];
  PAINTED.set(canvas, ops);
  const state = {
    pattern: [] as readonly number[],
    width: 1,
    font: "",
    align: "start",
    stroke: "#000",
    fill: "#000",
  };
  let path: PaintedPoint[] = [];
  const known: Record<string, unknown> = {
    canvas,
    setLineDash: (pattern: readonly number[]) => (state.pattern = [...pattern]),
    clearRect: () => (ops.length = 0),
    beginPath: () => (path = []),
    moveTo: (x: number, y: number) => path.push({ x, y }),
    lineTo: (x: number, y: number) => path.push({ x, y }),
    // oxlint-disable-next-line max-params -- the canvas 2D context's own signature, which it stands in for
    bezierCurveTo: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
      const from = path.at(-1) ?? { x, y };
      for (let i = 1; i <= CURVE_SAMPLES; i++) {
        const t = i / CURVE_SAMPLES;
        const u = 1 - t;
        const at = (a: number, b: number, c: number, d: number) =>
          u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
        path.push({ x: at(from.x, x1, x2, x), y: at(from.y, y1, y2, y) });
      }
    },
    stroke: () =>
      ops.push({
        op: "stroke",
        color: state.stroke,
        pattern: state.pattern,
        width: state.width,
        points: [...path],
      }),
    fill: () => ops.push({ op: "fill", color: state.fill, points: [...path] }),
    fillText: (text: string, _x: number, y: number) =>
      ops.push({ op: "text", text, color: state.fill, font: state.font, align: state.align, y }),
    measureText: (text: string) => ({ width: text.length * 6 }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
  };
  return new Proxy(known, {
    get: (target, key) =>
      typeof key !== "string"
        ? undefined
        : key === "lineWidth"
          ? state.width
          : key in target
            ? target[key]
            : /^[a-z]+[A-Z]|^(fill|stroke|scale|save|restore|translate|rotate|arc)/.test(key)
              ? noop
              : undefined,
    set: (_target, key, value) => {
      if (key === "lineWidth" && typeof value === "number") state.width = value;
      if (key === "font" && typeof value === "string") state.font = value;
      if (key === "textAlign" && typeof value === "string") state.align = value;
      if (key === "strokeStyle" && typeof value === "string") state.stroke = value;
      if (key === "fillStyle" && typeof value === "string") state.fill = value;
      return true;
    },
  });
}

function fakeGetContext(this: HTMLCanvasElement, kind: string) {
  return kind === "2d" ? fake2d(this) : null;
}

/** Give every canvas of a window (its `HTMLCanvasElement.prototype`) the {@link fake2d} context. */
export function fakeCanvasContexts(canvasPrototype: object): void {
  Object.defineProperty(canvasPrototype, "getContext", {
    value: fakeGetContext,
    configurable: true,
    writable: true,
  });
}
