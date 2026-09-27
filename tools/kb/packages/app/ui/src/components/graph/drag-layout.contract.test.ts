/**
 * The drag layout contract (`lib/graph-drag` → `DragLayout`): what every
 * graph layout promises a node drag, proved over each one.
 *
 * - **held where held**: a grabbed node stands where the drag holds it, for
 *   as long as it is held;
 * - **unknown nodes are ignored**: a drag of a node the layout does not hold
 *   (a new graph replaced it) moves nothing and wakes nothing;
 * - **a force layout runs while held**, past its own settle, so the held
 *   node's neighbours follow it;
 * - **the drop frees the node and the layout stops**: after the drop the
 *   forces move the node again (it is never left pinned), the layout cools
 *   and stops, and nothing is left scheduled — no frame after the settle.
 *
 * The rows are the 2D force layout (ForceAtlas2 on the page's frames; its
 * worker transport shares the pins and the timing, and the render suite
 * drags through it in a browser), the 3D force layout (d3-force-3d, on the
 * page and through its worker protocol), and the placed layouts.
 */
import Graph from "graphology";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragLayout, LayoutPoint } from "@/lib/graph-drag";
import { createFA2Layout } from "./fa2-layout";
import {
  serveLayout,
  startLayout3d,
  type LayoutReply,
  type LayoutRequest,
  type Layout3d,
} from "./force3d-layout";
import { graphPoint, placedDrag } from "./sigma-drag";

// --- a star (a hub and its six leaves) and, apart from it, a linked pair ---

const LEAVES = ["l0", "l1", "l2", "l3", "l4", "l5"];
const PAIR = ["u0", "u1"];
const IDS = ["h", ...LEAVES, ...PAIR];
const LINKS: readonly (readonly [string, string])[] = [
  ...LEAVES.map((leaf) => ["h", leaf] as const),
  ["u0", "u1"],
];
const start = (i: number) => ({
  x: Math.cos(i * 2.4) * Math.sqrt(i + 1) * 12,
  y: Math.sin(i * 2.4) * Math.sqrt(i + 1) * 12,
  z: Math.sin(i) * 30,
});

interface Running {
  readonly layout: DragLayout;
  point(id: string): Required<LayoutPoint>;
  running(): boolean;
  dispose(): void;
}

interface Row {
  readonly name: string;
  /** Whether the layout has forces (the neighbours follow), or only places. */
  readonly forces: boolean;
  /** Whether it lays out in depth. */
  readonly depth: boolean;
  start(): Running;
}

function starGraph(): Graph {
  const graph = new Graph({ multi: true, type: "directed" });
  IDS.forEach((id, i) => graph.addNode(id, { ...start(i), size: 4 }));
  for (const [a, b] of LINKS) graph.addEdge(a, b);
  return graph;
}

const flat = (graph: Graph) => (id: string) => ({ ...graphPoint(graph, id), z: 0 });

const fa2Row: Row = {
  name: "2D force (ForceAtlas2)",
  forces: true,
  depth: false,
  start: () => {
    const graph = starGraph();
    const layout = createFA2Layout(graph, { transport: "frames" });
    layout.start();
    return {
      layout,
      point: flat(graph),
      running: () => layout.isRunning(),
      dispose: () => layout.kill(),
    };
  },
};

const placedRow: Row = {
  name: "2D placed (radial, hierarchical, grid, cluster)",
  forces: false,
  depth: false,
  start: () => {
    const graph = starGraph();
    return {
      layout: placedDrag(graph),
      point: flat(graph),
      running: () => false,
      dispose: () => {},
    };
  },
};

/** The 3D layout by node id, as `GraphLayers.dragLayout` hands it to a drag. */
function by3dId(layout: Layout3d): DragLayout {
  const at = (id: string) => IDS.indexOf(id);
  return {
    grab: (id) => {
      if (at(id) >= 0) layout.grab(at(id));
    },
    hold: (id, p) => {
      if (at(id) >= 0) layout.hold(at(id), p.x, p.y, p.z ?? 0);
    },
    drop: (id) => {
      if (at(id) >= 0) layout.drop(at(id));
    },
  };
}

function run3d(): Running {
  const positions = new Float32Array(IDS.length * 3);
  IDS.forEach((_, i) => {
    const p = start(i);
    positions.set([p.x, p.y, p.z], i * 3);
  });
  let running = true;
  const layout = startLayout3d(
    {
      positions: positions.slice(),
      links: new Int32Array(LINKS.flatMap(([a, b]) => [IDS.indexOf(a), IDS.indexOf(b)])),
      params: { spread: 150, linkDistance: 60 },
      live: true,
    },
    (next, still) => {
      positions.set(next);
      running = still;
    },
  );
  return {
    layout: by3dId(layout),
    point: (id) => {
      const i = IDS.indexOf(id);
      return {
        x: positions[i * 3] ?? 0,
        y: positions[i * 3 + 1] ?? 0,
        z: positions[i * 3 + 2] ?? 0,
      };
    },
    running: () => running,
    dispose: () => layout.dispose(),
  };
}

/**
 * A worker as a browser runs one, in this thread: each side's messages
 * arrive on a later task, and the real `serveLayout` answers inside it.
 */
class ChannelWorker {
  private readonly page: ((event: { data: LayoutReply }) => void)[] = [];
  private readonly inside: ((event: { data: LayoutRequest }) => void)[] = [];
  private terminated = false;
  constructor() {
    serveLayout({
      addEventListener: (_type, listener) => this.inside.push(listener),
      postMessage: (message) => {
        setTimeout(() => {
          if (!this.terminated) for (const listener of this.page) listener({ data: message });
        }, 0);
      },
    });
  }
  addEventListener(_type: "message", listener: (event: { data: LayoutReply }) => void): void {
    this.page.push(listener);
  }
  postMessage(message: LayoutRequest): void {
    setTimeout(() => {
      if (!this.terminated) for (const listener of this.inside) listener({ data: message });
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

const d3Row: Row = {
  name: "3D force (d3-force-3d, page)",
  forces: true,
  depth: true,
  start: run3d,
};
const d3WorkerRow: Row = {
  name: "3D force (d3-force-3d, worker protocol)",
  forces: true,
  depth: true,
  start: () => {
    const g = globalThis as Record<string, unknown>;
    g.Worker = ChannelWorker;
    try {
      return run3d();
    } finally {
      delete g.Worker;
    }
  },
};

const ROWS: readonly Row[] = [fa2Row, placedRow, d3Row, d3WorkerRow];

// --- the properties ---------------------------------------------------------

/** Longer than any layout's own settle from a cold start. */
const SETTLE_MS = 6000;
/** Longer than any layout's cool after a drop. */
const COOL_MS = 4000;

const distance = (a: LayoutPoint, b: LayoutPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

/** Where the drag takes a leaf: out beyond the star, so what follows it must travel. */
function farFrom(running: Running, depth: boolean): Required<LayoutPoint> {
  const hub = running.point("h");
  const leaf = running.point("l0");
  const reach = distance(leaf, hub);
  const out = (axis: "x" | "y" | "z") =>
    leaf[axis] + ((leaf[axis] - hub[axis]) / reach) * reach * 3;
  return { x: out("x"), y: out("y"), z: depth ? out("z") : 0 };
}

/** How far `id` travelled toward `target` from `from`, as a share of the way. */
function gain(from: LayoutPoint, now: LayoutPoint, target: LayoutPoint): number {
  const way = { x: target.x - from.x, y: target.y - from.y, z: (target.z ?? 0) - (from.z ?? 0) };
  const length = Math.hypot(way.x, way.y, way.z);
  const moved =
    ((now.x - from.x) * way.x + (now.y - from.y) * way.y + ((now.z ?? 0) - (from.z ?? 0)) * way.z) /
    length;
  return moved / length;
}

describe.each(ROWS)("the drag layout contract: $name", (row) => {
  let subject: Running;
  beforeEach(async () => {
    vi.useFakeTimers();
    subject = row.start();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
  });
  afterEach(() => {
    subject.dispose();
    vi.useRealTimers();
  });

  it("stands a held node where it is held", async () => {
    const target = farFrom(subject, row.depth);
    subject.layout.grab("l0");
    subject.layout.hold("l0", target);
    await vi.advanceTimersByTimeAsync(500);
    expect(distance(subject.point("l0"), target)).toBeLessThan(1e-3);
    subject.layout.drop("l0");
  });

  it("ignores a node it does not hold", async () => {
    const before = IDS.map((id) => subject.point(id));
    subject.layout.grab("gone");
    subject.layout.hold("gone", { x: 1e4, y: 1e4, z: 1e4 });
    // Held without a grab: not a drag.
    subject.layout.hold("h", { x: 1e4, y: 1e4, z: 1e4 });
    subject.layout.drop("gone");
    await vi.advanceTimersByTimeAsync(500);
    expect(subject.running()).toBe(false);
    expect(IDS.map((id) => subject.point(id))).toEqual(before);
  });

  // A force layout's promises; a placed layout's is below.
  if (row.forces) {
    it("runs while a node is held, and its neighbours follow", async () => {
      expect(subject.running()).toBe(false);
      const target = farFrom(subject, row.depth);
      const before = new Map(IDS.map((id) => [id, subject.point(id)]));
      subject.layout.grab("l0");
      subject.layout.hold("l0", target);
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      expect(subject.running()).toBe(true);
      const followed = (id: string) => gain(before.get(id) ?? target, subject.point(id), target);
      // The hub is pulled a good way after its leaf; the pair it is not linked to is not.
      expect(followed("h")).toBeGreaterThan(0.2);
      for (const id of PAIR) expect(followed(id)).toBeLessThan(followed("h") / 2);
      subject.layout.drop("l0");
    });

    it("frees the node on the drop, cools, and leaves nothing scheduled", async () => {
      const target = farFrom(subject, row.depth);
      subject.layout.grab("l0");
      subject.layout.hold("l0", target);
      await vi.advanceTimersByTimeAsync(1000);
      subject.layout.drop("l0");
      await vi.advanceTimersByTimeAsync(COOL_MS);
      expect(subject.running()).toBe(false);
      expect(distance(subject.point("l0"), target)).toBeGreaterThan(1e-2);
      expect(vi.getTimerCount()).toBe(0);
    });
  } else {
    it("moves only the held node", async () => {
      const others = IDS.filter((id) => id !== "l0");
      const before = others.map((id) => subject.point(id));
      subject.layout.grab("l0");
      subject.layout.hold("l0", { x: 500, y: 500 });
      subject.layout.drop("l0");
      await vi.advanceTimersByTimeAsync(500);
      expect(others.map((id) => subject.point(id))).toEqual(before);
      expect(subject.point("l0")).toEqual({ x: 500, y: 500, z: 0 });
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});
