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
 *   ...(await import("@/test-support/fake-gpu")).FAKE_WEBGPU,
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
  compileAsync() {
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
export const FAKE_WEBGPU = { WebGPURenderer: FakeRenderer, PostProcessing: FakePost };

/** How many frames a stand-in renderer's post chain has drawn. */
export const renders = (renderer: FakeRenderer): number => renderer.post?.renders ?? 0;

/**
 * A 2D context that accepts every call and measures text at 6px a character,
 * enough for a scene to paint its textures (and read a blank glyph back).
 */
const noop = () => {};

function fake2d(canvas: HTMLCanvasElement) {
  const gradient = { addColorStop: () => {} };
  const known: Record<string, unknown> = {
    canvas,
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
        : key in target
          ? target[key]
          : /^[a-z]+[A-Z]|^(fill|stroke|scale|save|restore|translate|rotate|arc)/.test(key)
            ? noop
            : undefined,
    set: () => true,
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
