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

export interface LayoutParams {
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

/** The simulation's settle, in ticks; alpha falls to about 0.025 by then. */
export const COOLDOWN_TICKS = 160;
/**
 * A faint pull toward the origin. Charge alone pushes every unlinked node
 * out to the edge of the frame, so a graph with a few orphans is framed as
 * a speck; this keeps disconnected pieces near the whole without folding the
 * linked structure (link forces are far stronger).
 */
const GRAVITY = 0.035;
/** One tick per frame at 60 Hz, so a settle is watchable, not a jump. */
const TICK_MS = 16;

type Emit = (positions: Float32Array, running: boolean) => void;

interface SimNode {
  index?: number;
  x?: number;
  y?: number;
  z?: number;
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
  let ticks = 0;
  const setParams = (params: LayoutParams) => {
    link.distance(params.linkDistance);
    charge.strength(-params.spread);
  };
  setParams(seed.params);
  return {
    running: () => ticks < COOLDOWN_TICKS,
    tick: () => {
      sim.tick();
      ticks++;
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
      ticks = 0;
    },
  };
}

/**
 * Tick `seed` to rest, handing positions to `emit` whenever `take` offers a
 * buffer (the page may still hold both). Returns the driver's two controls.
 */
export function driveLayout(
  seed: LayoutSeed,
  take: () => Float32Array | null,
  emit: Emit,
): { reheat: (params: LayoutParams) => void; stop: () => void } {
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
  return {
    reheat: (params) => {
      sim.reheat(params);
      if (timer === null) step();
    },
    stop: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** What the page and the worker say to each other. */
export type LayoutRequest =
  | { readonly type: "seed"; readonly seed: LayoutSeed; readonly buffers: Float32Array[] }
  | { readonly type: "reheat"; readonly params: LayoutParams }
  | { readonly type: "return"; readonly buffer: Float32Array };
export type LayoutReply = {
  readonly type: "positions";
  readonly positions: Float32Array;
  readonly running: boolean;
};

export interface Layout3d {
  reheat(params: LayoutParams): void;
  /** Hand a positions buffer back once it has been read. */
  release(buffer: Float32Array): void;
  dispose(): void;
}

/**
 * Lay out `seed`, calling `onPositions` with each new set; the caller reads
 * the buffer and `release`s it. The worker is a module worker Vite bundles.
 */
export function startLayout3d(
  seed: LayoutSeed,
  onPositions: (positions: Float32Array, running: boolean) => void,
): Layout3d {
  const buffers = [0, 1].map(() => new Float32Array(seed.positions.length));
  if (typeof Worker === "undefined") {
    const free: Float32Array[] = [...buffers];
    const driver = driveLayout(seed, () => free.pop() ?? null, onPositions);
    return {
      reheat: driver.reheat,
      release: (buffer) => {
        free.push(buffer);
      },
      dispose: driver.stop,
    };
  }
  const worker = new Worker(new URL("./force3d-layout.worker.ts", import.meta.url), {
    type: "module",
  });
  const send = (request: LayoutRequest, transfer: Transferable[] = []) =>
    worker.postMessage(request, { transfer });
  worker.addEventListener("message", (event: MessageEvent<LayoutReply>) => {
    onPositions(event.data.positions, event.data.running);
  });
  send(
    { type: "seed", seed, buffers },
    buffers.map((b) => b.buffer),
  );
  return {
    reheat: (params) => send({ type: "reheat", params }),
    release: (buffer) => send({ type: "return", buffer }, [buffer.buffer]),
    dispose: () => worker.terminate(),
  };
}
