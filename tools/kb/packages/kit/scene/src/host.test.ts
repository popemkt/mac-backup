/**
 * The scene host's side of the contract, over a stand-in scene: an in-flight
 * mount never outlives its element, the scene is sized and paused with it,
 * and detaching disposes it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { attachScene, type SceneHandle } from "./host";

interface Probe extends SceneHandle {
  sizes: [number, number][];
  running: boolean[];
  disposed: number;
}

function probe(): Probe {
  const p: Probe = {
    backend: "WebGL2",
    sizes: [],
    running: [],
    disposed: 0,
    resize: (w, h) => p.sizes.push([w, h]),
    setRunning: (r) => p.running.push(r),
    setReducedMotion: () => {},
    dispose: () => {
      p.disposed += 1;
    },
  };
  return p;
}

const observers: (() => void)[] = [];
const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

describe("attachScene", () => {
  let dom: Window;
  let el: HTMLElement;
  const g = globalThis as Record<string, unknown>;

  beforeAll(() => {
    dom = new Window();
    g.document = dom.document;
    g.ResizeObserver = class {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe() {
        observers.push(this.callback);
      }
      disconnect() {
        const at = observers.indexOf(this.callback);
        if (at >= 0) observers.splice(at, 1);
      }
    };
  });

  afterAll(() => {
    delete g.document;
    delete g.ResizeObserver;
  });

  beforeEach(() => {
    observers.length = 0;
    el = dom.document.createElement("div") as unknown as HTMLElement;
  });

  it("sizes and runs the scene on arrival, and reports it ready", async () => {
    const scene = probe();
    let ready: SceneHandle | null = null;
    attachScene(el, Promise.resolve(scene), { onReady: (s) => (ready = s), onError: () => {} });
    await settle();
    expect(ready).toBe(scene);
    expect(scene.sizes).toHaveLength(1);
    expect(scene.running).toEqual([true]);
  });

  it("resizes with its element and stops observing once detached", async () => {
    const scene = probe();
    const detach = attachScene(el, Promise.resolve(scene), {
      onReady: () => {},
      onError: () => {},
    });
    await settle();
    for (const notify of observers) notify();
    expect(scene.sizes).toHaveLength(2);
    detach();
    expect(observers).toHaveLength(0);
    expect(scene.disposed).toBe(1);
  });

  it("disposes a scene that arrives after its element has gone", async () => {
    const scene = probe();
    const pending = Promise.withResolvers<Probe>();
    let ready = false;
    const detach = attachScene(el, pending.promise, {
      onReady: () => (ready = true),
      onError: () => {},
    });
    detach();
    pending.resolve(scene);
    await settle();
    expect(ready).toBe(false);
    expect(scene.disposed).toBe(1);
  });

  it("pauses while the tab is hidden", async () => {
    const scene = probe();
    const detach = attachScene(el, Promise.resolve(scene), {
      onReady: () => {},
      onError: () => {},
    });
    await settle();
    Object.defineProperty(dom.document, "visibilityState", { value: "hidden", configurable: true });
    dom.document.dispatchEvent(new dom.Event("visibilitychange"));
    expect(scene.running).toEqual([true, false]);
    Object.defineProperty(dom.document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    detach();
  });

  it("reports a failed mount, and not after detaching", async () => {
    const errors: string[] = [];
    attachScene(el, Promise.reject(new Error("no GPU")), {
      onReady: () => {},
      onError: (e) => errors.push(e.message),
    });
    const detach = attachScene(el, Promise.reject(new Error("late")), {
      onReady: () => {},
      onError: (e) => errors.push(e.message),
    });
    detach();
    await settle();
    expect(errors).toEqual(["no GPU"]);
  });
});
