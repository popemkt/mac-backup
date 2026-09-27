/**
 * The 3D graph's layout: a d3-force-3d simulation (charge, links, centre —
 * the physics the lens's `spread` and `linkDistance` name), run off the main
 * thread in a worker so the scene keeps its frame rate while a few thousand
 * nodes settle (Lab principle P3). Without a worker (a test DOM) the same
 * driver runs on the main thread.
 *
 * The positions travel as one Float32Array per post, ping-ponged between two
 * buffers the worker and the page hand back and forth, so a tick allocates
 * nothing. Under reduced motion the layout is not watched settling: it runs
 * to rest unseen and posts once (M7).
 */
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
} from "d3-force-3d";

interface LayoutParams {
  /** Charge: how hard nodes push apart. */
  readonly spread: number;
  readonly linkDistance: number;
}

export interface LayoutSeed {
  /** x, y, z per node: where each starts. */
  readonly positions: Float32Array;
  /** Node index pairs, source then target. */
  readonly links: Int32Array;
  readonly params: LayoutParams;
  /** Post every tick (the layout is seen settling), or only the rest state. */
  readonly live: boolean;
}

/**
 * The simulation is at rest once its alpha has cooled to this: from a full
 * heat of 1, about 160 ticks (under three seconds at one tick a frame).
 */
const REST_ALPHA = 0.025;
/**
 * A faint pull toward the origin. Charge alone pushes every unlinked node
 * out to the edge of the frame, so a graph with a few orphans is framed as
 * a speck; this keeps disconnected pieces near the whole without folding the
 * linked structure (link forces are far stronger).
 */
const GRAVITY = 0.035;
/** One tick per frame at 60 Hz, so a settle is watchable, not a jump. */
const TICK_MS = 16;
/**
 * The heat a drag holds the layout at (d3's own drag convention): enough for
 * the neighbours to follow the held node live; after the drop it cools from
 * here to rest in under two seconds.
 */
const DRAG_ALPHA = 0.3;

type Emit = (positions: Float32Array, running: boolean) => void;

interface SimNode {
  index?: number;
  x?: number;
  y?: number;
  z?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

/** The layout's side of a node drag (`lib/graph-drag`), by node index. */
interface LayoutDrag {
  grab(index: number): void;
  hold(index: number, x: number, y: number, z: number): void;
  drop(index: number): void;
}

/** Stand `node` at (x, y, z), fixed there. */
function pin(node: SimNode, x: number, y: number, z: number): void {
  node.x = node.fx = x;
  node.y = node.fy = y;
  node.z = node.fz = z;
}

/** A simulation over `seed`, ticked by hand. */
function simulation(seed: LayoutSeed) {
  const n = seed.positions.length / 3;
  const nodes: SimNode[] = Array.from({ length: n }, (_, i) => ({
    x: seed.positions[i * 3] ?? 0,
    y: seed.positions[i * 3 + 1] ?? 0,
    z: seed.positions[i * 3 + 2] ?? 0,
  }));
  const links = Array.from({ length: seed.links.length / 2 }, (_, i) => ({
    source: seed.links[i * 2] ?? 0,
    target: seed.links[i * 2 + 1] ?? 0,
  }));
  const link = forceLink<SimNode, { source: number | SimNode; target: number | SimNode }>(links);
  const charge = forceManyBody();
  const sim = forceSimulation(nodes, 3)
    .alphaDecay(0.0228)
    .velocityDecay(0.4)
    .force("link", link)
    .force("charge", charge)
    .force("center", forceCenter())
    .force("x", forceX().strength(GRAVITY))
    .force("y", forceY().strength(GRAVITY))
    .force("z", forceZ().strength(GRAVITY))
    .stop();
  const setParams = (params: LayoutParams) => {
    link.distance(params.linkDistance);
    charge.strength(-params.spread);
  };
  setParams(seed.params);
  const held = new Set<number>();
  /**
   * A drag heats the layout. Watched live, it is held at the drag's heat for
   * as long as any node is held; settling unseen, each move heats it once
   * and it runs to rest around where the node now stands.
   */
  const heat = () => {
    sim.alphaTarget(seed.live && held.size > 0 ? DRAG_ALPHA : 0);
    if (sim.alpha() < DRAG_ALPHA) sim.alpha(DRAG_ALPHA);
  };
  const drag: LayoutDrag = {
    grab: (i) => {
      const node = nodes[i];
      if (node === undefined) return;
      held.add(i);
      pin(node, node.x ?? 0, node.y ?? 0, node.z ?? 0);
      heat();
    },
    hold: (i, x, y, z) => {
      const node = nodes[i];
      if (node === undefined || !held.has(i)) return;
      pin(node, x, y, z);
      heat();
    },
    drop: (i) => {
      const node = nodes[i];
      if (node === undefined || !held.delete(i)) return;
      node.fx = node.fy = node.fz = null;
      heat();
    },
  };
  return {
    drag,
    running: () => sim.alpha() > REST_ALPHA,
    tick: () => {
      sim.tick();
    },
    write: (out: Float32Array) => {
      for (let i = 0; i < n; i++) {
        const node = nodes[i];
        out[i * 3] = node?.x ?? 0;
        out[i * 3 + 1] = node?.y ?? 0;
        out[i * 3 + 2] = node?.z ?? 0;
      }
    },
    /** New physics: the layout warms up and settles again. */
    reheat: (params: LayoutParams) => {
      setParams(params);
      sim.alpha(1);
    },
  };
}

/** A running layout's controls: new physics, a node drag, and stopping it. */
interface LayoutDriver extends LayoutDrag {
  reheat(params: LayoutParams): void;
  stop(): void;
}

/**
 * Tick `seed` to rest, handing positions to `emit` whenever `take` offers a
 * buffer (the page may still hold both). Returns the driver's controls.
 */
function driveLayout(seed: LayoutSeed, take: () => Float32Array | null, emit: Emit): LayoutDriver {
  const sim = simulation(seed);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const post = () => {
    const buffer = take();
    if (buffer === null) return false;
    sim.write(buffer);
    emit(buffer, sim.running());
    return true;
  };
  const step = () => {
    timer = null;
    const started = Date.now();
    if (!seed.live) while (sim.running()) sim.tick();
    else if (sim.running()) sim.tick();
    // At rest, and the rest state has reached the page: nothing more to do.
    if (post() && !sim.running()) return;
    timer = setTimeout(step, Math.max(0, TICK_MS - (Date.now() - started)));
  };
  step();
  const wake = () => {
    if (timer === null) step();
  };
  return {
    reheat: (params) => {
      sim.reheat(params);
      wake();
    },
    grab: (i) => {
      sim.drag.grab(i);
      wake();
    },
    // A move is taken on the next step, not this one: moves that arrive
    // faster than steps are coalesced into the latest.
    hold: (i, x, y, z) => {
      sim.drag.hold(i, x, y, z);
      if (timer === null) timer = setTimeout(step, 0);
    },
    drop: (i) => {
      sim.drag.drop(i);
      wake();
    },
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * What the page and the worker say to each other. Every message carries the
 * generation of the layout it belongs to: a layout that has been replaced
 * may still have replies queued on the page after its worker is terminated,
 * and those must never reach the scene or the new layout's buffer pool.
 */
export type LayoutRequest =
  | {
      readonly type: "seed";
      readonly generation: number;
      readonly seed: LayoutSeed;
      readonly buffers: Float32Array[];
    }
  | { readonly type: "reheat"; readonly generation: number; readonly params: LayoutParams }
  | {
      readonly type: "grab" | "drop";
      readonly generation: number;
      readonly index: number;
    }
  | {
      readonly type: "hold";
      readonly generation: number;
      readonly index: number;
      readonly at: readonly [number, number, number];
    }
  | { readonly type: "return"; readonly generation: number; readonly buffer: Float32Array };
export type LayoutReply = {
  readonly type: "positions";
  readonly generation: number;
  readonly positions: Float32Array;
  readonly running: boolean;
};

/** The two ends of a message channel, as the worker and a test see them. */
export interface LayoutPort<In, Out> {
  addEventListener(type: "message", listener: (event: { data: In }) => void): void;
  postMessage(message: Out, options: { transfer: Transferable[] }): void;
}

/**
 * The worker side: own one simulation, lend its positions back in the
 * buffers the page sent with the seed, and take back only buffers of that
 * generation (a stale or foreign buffer never joins the pool).
 */
export function serveLayout(port: LayoutPort<LayoutRequest, LayoutReply>): void {
  let driver: ReturnType<typeof driveLayout> | null = null;
  let generation = -1;
  let size = 0;
  const free: Float32Array[] = [];
  port.addEventListener("message", ({ data: request }) => {
    if (request.type === "seed") {
      driver?.stop();
      generation = request.generation;
      size = request.seed.positions.length;
      free.length = 0;
      free.push(...request.buffers);
      const current = generation;
      driver = driveLayout(
        request.seed,
        () => free.pop() ?? null,
        (positions, running) => {
          const reply: LayoutReply = { type: "positions", generation: current, positions, running };
          port.postMessage(reply, { transfer: [positions.buffer] });
        },
      );
      return;
    }
    if (request.generation !== generation || driver === null) return;
    switch (request.type) {
      case "reheat":
        driver.reheat(request.params);
        return;
      case "grab":
        driver.grab(request.index);
        return;
      case "hold":
        driver.hold(request.index, ...request.at);
        return;
      case "drop":
        driver.drop(request.index);
        return;
      case "return":
        if (request.buffer.length === size) free.push(request.buffer);
        return;
      default:
        request satisfies never;
    }
  });
}

export interface Layout3d extends LayoutDrag {
  reheat(params: LayoutParams): void;
  dispose(): void;
}

/** Each layout's generation: unique for the page's life. */
let generations = 0;

/**
 * Lay out `seed`, calling `onPositions` with each new set. The buffer is
 * lent for the call only: read it before returning, the layout takes it
 * back. After `dispose`, nothing more arrives, even a reply already queued.
 * The worker is a module worker Vite bundles; without one (a test DOM) the
 * same driver runs on the main thread.
 */
export function startLayout3d(
  seed: LayoutSeed,
  onPositions: (positions: Float32Array, running: boolean) => void,
): Layout3d {
  const generation = generations++;
  let disposed = false;
  const buffers = [0, 1].map(() => new Float32Array(seed.positions.length));
  if (typeof Worker === "undefined") {
    const free: Float32Array[] = [...buffers];
    const driver = driveLayout(
      seed,
      () => free.pop() ?? null,
      (positions, running) => {
        if (!disposed) onPositions(positions, running);
        free.push(positions);
      },
    );
    return {
      reheat: (params) => driver.reheat(params),
      grab: (index) => driver.grab(index),
      hold: (index, x, y, z) => driver.hold(index, x, y, z),
      drop: (index) => driver.drop(index),
      dispose: () => {
        disposed = true;
        driver.stop();
      },
    };
  }
  const worker = new Worker(new URL("./force3d-layout.worker.ts", import.meta.url), {
    type: "module",
  });
  const send = (request: LayoutRequest, transfer: Transferable[] = []) =>
    worker.postMessage(request, { transfer });
  worker.addEventListener("message", (event: MessageEvent<LayoutReply>) => {
    const reply = event.data;
    // A reply from another generation, or one queued before dispose, is dropped:
    // its coordinates are stale and its buffer belongs to a terminated worker.
    if (disposed || reply.generation !== generation) return;
    onPositions(reply.positions, reply.running);
    send({ type: "return", generation, buffer: reply.positions }, [reply.positions.buffer]);
  });
  send(
    { type: "seed", generation, seed, buffers },
    buffers.map((b) => b.buffer),
  );
  return {
    reheat: (params) => {
      if (!disposed) send({ type: "reheat", generation, params });
    },
    grab: (index) => {
      if (!disposed) send({ type: "grab", generation, index });
    },
    hold: (index, x, y, z) => {
      if (!disposed) send({ type: "hold", generation, index, at: [x, y, z] });
    },
    drop: (index) => {
      if (!disposed) send({ type: "drop", generation, index });
    },
    dispose: () => {
      disposed = true;
      worker.terminate();
    },
  };
}
