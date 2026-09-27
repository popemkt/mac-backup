/**
 * The 2D force layout: ForceAtlas2 in a web worker with a timed settle, or,
 * where there is no worker, the same settings run a chunk of iterations a
 * frame on the page. Either way it is a `DragLayout` (`lib/graph-drag`): a
 * held node is pinned under the pointer and the layout runs for as long as
 * it is held, so its neighbours follow; the drop unpins it, and the layout
 * cools for a short burst and stops.
 */
import type Graph from "graphology";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { DragLayout, LayoutPoint } from "@/lib/graph-drag";
import { separateDiscs } from "./graph-discs";
import { graphPoint } from "./sigma-drag";

export interface FA2Controller extends DragLayout {
  start(): void;
  stop(): void;
  kill(): void;
  isRunning(): boolean;
}

const SETTLE_TIMEOUT_MS = 2500;
/** How long the layout runs on after a drop before it settles. */
const DROP_COOL_MS = 800;
/** One frame of the page-side run. */
const FRAME_MS = 16;

function detectWorkerSupport(): boolean {
  try {
    return typeof Worker !== "undefined";
  } catch {
    return false;
  }
}

const USE_WORKER = detectWorkerSupport();

/**
 * The one ForceAtlas2 setting set, worker and fallback alike: inferred from
 * the graph, with a strong, gentle gravity so nodes with no links settle near
 * the rest instead of drifting to the frame's corners as specks.
 */
export function fa2Settings(graph: Graph) {
  return {
    ...forceAtlas2.inferSettings(graph),
    barnesHutOptimize: graph.order > 500,
    strongGravityMode: true,
    gravity: 0.3,
  };
}

/**
 * The held nodes. A held node is ForceAtlas2's `fixed` (no force moves it,
 * so it pulls its neighbours at full strength) and stands at its pin: every
 * write of the layout back to the graph passes through `reduce`, which is
 * also how a moved pin reaches a worker's copy of the positions.
 */
class Pins {
  private readonly at = new Map<string, LayoutPoint>();
  private readonly graph: Graph;
  constructor(graph: Graph) {
    this.graph = graph;
  }
  get size(): number {
    return this.at.size;
  }
  has(id: string): boolean {
    return this.at.has(id);
  }
  set(id: string, at: LayoutPoint): void {
    this.at.set(id, at);
    this.graph.mergeNodeAttributes(id, { x: at.x, y: at.y, fixed: true });
  }
  delete(id: string): boolean {
    if (!this.at.delete(id)) return false;
    if (this.graph.hasNode(id)) this.graph.removeNodeAttribute(id, "fixed");
    return true;
  }
  readonly reduce = (id: string, attrs: { x: number; y: number }) => {
    const pin = this.at.get(id);
    if (pin !== undefined) {
      attrs.x = pin.x;
      attrs.y = pin.y;
    }
    return attrs;
  };
}

/** How a transport runs ForceAtlas2: the controller decides for how long. */
interface Transport {
  /** Run for `ms` from now (Infinity: until told otherwise), then settle. */
  runFor(ms: number): void;
  /** A node was fixed or freed: the running layout must see it. */
  refix(): void;
  start(): void;
  stop(): void;
  kill(): void;
  isRunning(): boolean;
}

interface Converge {
  readonly onConverged?: () => void;
}

/**
 * Create the force layout over `graph`: in a worker where there is one, on
 * the page's frames otherwise (`transport` forces one, for a test).
 */
export function createFA2Layout(
  graph: Graph,
  opts?: Converge & { readonly transport?: "worker" | "frames" },
): FA2Controller {
  const pins = new Pins(graph);
  const kind = opts?.transport ?? (USE_WORKER && graph.order > 0 ? "worker" : "frames");
  const transport =
    kind === "worker" ? workerTransport(graph, pins, opts) : framesTransport(graph, pins, opts);
  return {
    start: () => transport.start(),
    stop: () => transport.stop(),
    kill: () => transport.kill(),
    isRunning: () => transport.isRunning(),
    grab(id) {
      if (!graph.hasNode(id)) return;
      pins.set(id, graphPoint(graph, id));
      transport.refix();
      transport.runFor(Infinity);
    },
    hold(id, at) {
      if (!pins.has(id) || !graph.hasNode(id)) return;
      pins.set(id, at);
    },
    drop(id) {
      if (!pins.delete(id)) return;
      transport.refix();
      if (pins.size === 0) transport.runFor(DROP_COOL_MS);
    },
  };
}

function workerTransport(graph: Graph, pins: Pins, opts?: Converge): Transport {
  const spawn = () =>
    new FA2Layout(graph, { settings: fa2Settings(graph), outputReducer: pins.reduce });
  let layout = spawn();

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function clearSettle() {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  function runFor(ms: number) {
    clearSettle();
    if (!running) {
      running = true;
      layout.start();
    }
    if (ms === Infinity) return;
    settleTimer = setTimeout(() => {
      settleTimer = null;
      layout.stop();
      running = false;
      separateDiscs(graph);
      opts?.onConverged?.();
    }, ms);
  }

  return {
    runFor,
    // The worker reads which nodes are fixed only when it starts, so a new
    // hold or drop starts a fresh one from the positions as they stand.
    refix() {
      layout.kill();
      layout = spawn();
      if (running) layout.start();
    },
    start() {
      if (!running) runFor(SETTLE_TIMEOUT_MS);
    },
    stop() {
      clearSettle();
      if (running) {
        layout.stop();
        running = false;
      }
    },
    kill() {
      clearSettle();
      running = false;
      layout.kill();
    },
    isRunning: () => running,
  };
}

/** The next frame: an animation frame, or one frame's time without one. */
const nextFrame = (run: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(run, FRAME_MS);
  return () => clearTimeout(id);
};

function framesTransport(graph: Graph, pins: Pins, opts?: Converge): Transport {
  let cancel: (() => void) | null = null;
  let running = false;
  /** Frames left to run; each runs a chunk of iterations. */
  let framesLeft = 0;
  const CHUNK = 10;

  const settings = fa2Settings(graph);

  function tick() {
    cancel = null;
    if (framesLeft <= 0 || graph.order === 0) {
      running = false;
      separateDiscs(graph);
      opts?.onConverged?.();
      return;
    }
    forceAtlas2.assign(graph, { iterations: CHUNK, settings, outputReducer: pins.reduce });
    framesLeft -= 1;
    cancel = nextFrame(tick);
  }

  function run(frames: number) {
    framesLeft = frames;
    if (!running) {
      running = true;
      cancel = nextFrame(tick);
    }
  }

  function stop() {
    running = false;
    framesLeft = 0;
    cancel?.();
    cancel = null;
  }

  return {
    runFor: (ms) => run(ms === Infinity ? Infinity : Math.ceil(ms / FRAME_MS)),
    // Each chunk reads the graph afresh, `fixed` included.
    refix: () => {},
    start() {
      if (!running) run(Math.ceil(Math.min(120, 40 + graph.order) / CHUNK));
    },
    stop,
    kill: stop,
    isRunning: () => running,
  };
}
