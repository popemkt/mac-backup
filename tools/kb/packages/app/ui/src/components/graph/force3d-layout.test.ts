/**
 * The 3D layout's page ↔ worker plumbing, end to end: `startLayout3d` on the
 * page, the real `serveLayout` in the "worker", and between them a channel
 * that behaves like a browser's — messages are delivered asynchronously, and
 * a reply the worker posted before `terminate()` is still delivered after it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  serveLayout,
  startLayout3d,
  type LayoutReply,
  type LayoutRequest,
  type LayoutSeed,
} from "./force3d-layout";

type Listener<T> = (event: { data: T }) => void;

/** Everything the fake workers have posted to the page, for inspection. */
let replies: LayoutReply[] = [];
const workers: FakeWorker[] = [];

class FakeWorker {
  private readonly page: Listener<LayoutReply>[] = [];
  private readonly inside: Listener<LayoutRequest>[] = [];
  terminated = false;
  private readonly inFlight: LayoutReply[] = [];

  /** The page's event loop reaches the replies queued so far. */
  deliver(): void {
    for (const message of this.inFlight.splice(0))
      for (const listener of this.page) listener({ data: message });
  }

  constructor() {
    workers.push(this);
    serveLayout({
      addEventListener: (_type, listener) => this.inside.push(listener),
      postMessage: (message) => {
        // A dead worker posts nothing new; what it posted before is in flight.
        if (this.terminated) return;
        replies.push(message);
        // Queued on the page until a test lets it land (`deliver`).
        this.inFlight.push(message);
      },
    });
  }

  addEventListener(_type: "message", listener: Listener<LayoutReply>): void {
    this.page.push(listener);
  }

  postMessage(message: LayoutRequest): void {
    setTimeout(() => {
      if (this.terminated) return;
      for (const listener of this.inside) listener({ data: message });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function seed(count: number): LayoutSeed {
  const positions = new Float32Array(count * 3).map((_, i) => (i % 7) - 3);
  return {
    positions,
    links: new Int32Array(
      Array.from({ length: (count - 1) * 2 }, (_, i) => (i % 2 ? i / 2 + 0.5 : 0)),
    ),
    params: { spread: 60, linkDistance: 30 },
    // Reduced motion: the layout runs to rest unseen and posts once.
    live: false,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
/** Poll until `ready` holds; a condition that never holds fails here, not later. */
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await tick();
  if (!ready()) throw new Error("the worker never reached the awaited state within 1 s");
}

describe("the 3D layout's worker plumbing", () => {
  const g = globalThis as Record<string, unknown>;
  beforeEach(() => {
    replies = [];
    workers.length = 0;
    g.Worker = FakeWorker;
  });
  afterEach(() => {
    delete g.Worker;
  });

  it("drops a replaced layout's queued reply, and the new one gets its own", async () => {
    const seen: { layout: string; size: number; running: boolean }[] = [];
    const first = startLayout3d(seed(4), (p, running) =>
      seen.push({ layout: "first", size: p.length, running }),
    );
    // Wait until the first worker has posted its rest state, then replace it
    // before the page has read it: the reply is queued, the worker is gone.
    await until(() => replies.length > 0);
    first.dispose();
    const second = startLayout3d(seed(6), (p, running) =>
      seen.push({ layout: "second", size: p.length, running }),
    );
    await until(() => replies.length > 1);
    // Both replies land now, the stale one first.
    workers[0]?.deliver();
    workers[1]?.deliver();
    expect(seen.filter((s) => s.layout === "first")).toEqual([]);
    expect(seen.filter((s) => s.layout === "second")).toEqual([
      { layout: "second", size: 18, running: false },
    ]);
    expect(workers[0]?.terminated).toBe(true);
    second.dispose();
  });

  it("delivers a live layout's reply (the control for the case above)", async () => {
    const seen: number[] = [];
    const only = startLayout3d(seed(4), (p) => seen.push(p.length));
    await until(() => replies.length > 0);
    workers[0]?.deliver();
    expect(seen).toEqual([12]);
    only.dispose();
  });

  it("takes back only buffers of its own generation and size", async () => {
    const posted: LayoutReply[] = [];
    const inside: Listener<LayoutRequest>[] = [];
    serveLayout({
      addEventListener: (_type, listener) => inside.push(listener),
      postMessage: (message) => posted.push(message),
    });
    const send = (request: LayoutRequest) => {
      for (const listener of inside) listener({ data: request });
    };
    const s = { ...seed(3), live: true };
    send({ type: "seed", generation: 7, seed: s, buffers: [new Float32Array(9)] });
    await until(() => posted.length > 0);
    await tick();
    // The one buffer is out; nothing more can be posted until it comes back.
    expect(posted).toHaveLength(1);
    send({ type: "return", generation: 6, buffer: new Float32Array(9) });
    send({ type: "return", generation: 7, buffer: new Float32Array(12) });
    await tick();
    await tick();
    expect(posted).toHaveLength(1);
    send({ type: "return", generation: 7, buffer: new Float32Array(9) });
    await until(() => posted.length > 1);
    expect(posted.every((reply) => reply.generation === 7 && reply.positions.length === 9)).toBe(
      true,
    );
  });
});
