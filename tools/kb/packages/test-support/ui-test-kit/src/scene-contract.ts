/**
 * The scene contract: what every `SceneHandle` promises (`@kb/scene`'s `host`,
 * DESIGN-UI.md → The lab), as one suite a package runs over the scenes it
 * registers. A promise one scene keeps and another breaks goes red.
 *
 * - disposing leaves no live renderer, no loop and no canvas;
 * - a hidden scene draws nothing;
 * - under reduced motion no animation loop runs;
 * - the device pixel ratio never exceeds 2, whatever the display's;
 * - a scene whose start fails gives its stage back.
 *
 * happy-dom has no GPU, so the file that runs it swaps three's renderer and
 * post chain for the stand-ins in `./fake-gpu`, which count what they are
 * asked to do; every other three class, every TSL node graph and every
 * scene's own code is the real thing:
 *
 * ```ts
 * vi.mock("three/webgpu", async (importOriginal) => ({
 *   ...(await importOriginal<typeof ThreeWebGpu>()),
 *   ...(await import("@kb/ui-test-kit")).FAKE_WEBGPU,
 * }));
 * ```
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import type { SceneHandle } from "@kb/scene";
// Types only: the file that runs the suite mocks three/webgpu with this
// package's stand-ins, so a value import here would load the module its own
// mock factory is waiting on. The classes are read when a test runs.
import type { Object3D } from "three/webgpu";
import { fakeCanvasContexts, gpu, renders, type FakeRenderer } from "./fake-gpu";

/** How one registered scene mounts on a host element. */
export type SceneMount = (host: HTMLElement, reducedMotion: boolean) => Promise<SceneHandle>;

/** A fresh host element on the installed window's body. */
type StageHost = () => HTMLElement;

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

/** Install a window whose frames this suite drives; returns it and the undo. */
function installWindow(): { dom: Window; restore: () => void } {
  const dom = new Window();
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>();
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
  const restore = () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
  return { dom, restore };
}

/** What a mounted-then-disposed scene drew with and did not give back. */
async function leakedBy(mount: SceneMount, host: StageHost): Promise<string[]> {
  const {
    BufferGeometry,
    Material,
    Object3D: Object3DClass,
    Sprite,
  } = await import("three/webgpu");
  const added = vi.spyOn(Object3DClass.prototype, "add");
  const geometries = vi.spyOn(BufferGeometry.prototype, "dispose");
  const materials = vi.spyOn(Material.prototype, "dispose");
  const scene = await mount(host(), false);
  scene.setRunning(true);
  scene.dispose();
  const disposed = new Set<unknown>([...geometries.mock.contexts, ...materials.mock.contexts]);
  const leaked: string[] = [];
  const drawn = added.mock.calls.flat().filter((one) => one instanceof Object3DClass);
  for (const root of drawn) {
    root.traverse((object: Object3D & { geometry?: unknown; material?: unknown }) => {
      // Every sprite shares three's one quad (`@kb/scene-gpu`'s `dispose`), which is never freed.
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
  return leaked;
}

/** Disposing gives everything back, and a failed start gives its stage back. */
function disposalPromises(mount: SceneMount, host: StageHost): void {
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
    expect(await leakedBy(mount, host)).toEqual([]);
  });

  it("gives its stage back when its start fails", async () => {
    const before = gpu.live.size;
    gpu.failRender = true;
    await expect(mount(host(), false)).rejects.toThrow("shader compile failed");
    expect(gpu.live.size).toBe(before);
  });
}

/** A running scene draws only while shown, holds still under reduced motion, and caps its pixel ratio. */
function runningPromises(mount: SceneMount, host: StageHost, window: () => Window): void {
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
    Reflect.set(window(), "devicePixelRatio", 3);
    scene.resize(800, 600);
    expect(renderer.pixelRatio).toBeGreaterThan(0);
    expect(renderer.pixelRatio).toBeLessThanOrEqual(2);
    Reflect.set(window(), "devicePixelRatio", 1);
    scene.dispose();
  });
}

/** Hold every scene in `scenes` to the contract, each under its name. */
export function sceneContract(scenes: readonly (readonly [string, SceneMount])[]): void {
  describe("scene contract", () => {
    let installed: ReturnType<typeof installWindow> | undefined;
    const hosts: HTMLElement[] = [];

    beforeAll(() => {
      installed = installWindow();
    });
    afterAll(() => installed?.restore());
    afterEach(() => {
      gpu.failRender = false;
      frameQueue = [];
      for (const el of hosts.splice(0)) el.remove();
    });

    const host: StageHost = () => {
      // The globals are the installed window's, so the page's DOM types hold.
      const el = document.createElement("div");
      document.body.appendChild(el);
      hosts.push(el);
      return el;
    };
    const window = (): Window => {
      if (installed === undefined) throw new Error("no window installed");
      return installed.dom;
    };

    describe.each(scenes)("%s", (_name, mount) => {
      disposalPromises(mount, host);
      runningPromises(mount, host, window);
    });
  });
}
