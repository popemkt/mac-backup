/**
 * FA2 layout orchestration: worker-based ForceAtlas2 with settle detection,
 * reheat on drag/topology change, and rAF-chunked synchronous fallback.
 */
import type Graph from "graphology";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";

export interface FA2Controller {
  start(): void;
  stop(): void;
  kill(): void;
  reheat(durationMs?: number): void;
  isRunning(): boolean;
}

const SETTLE_TIMEOUT_MS = 2500;
const REHEAT_DURATION_MS = 800;

function detectWorkerSupport(): boolean {
  try {
    return typeof Worker !== "undefined";
  } catch {
    return false;
  }
}

const USE_WORKER = detectWorkerSupport();

/**
 * Create a worker-driven FA2 layout that settles automatically.
 * Falls back to rAF-chunked synchronous assign when workers are unavailable.
 */
export function createFA2Layout(graph: Graph, opts?: { onConverged?: () => void }): FA2Controller {
  if (USE_WORKER && graph.order > 0) {
    return createWorkerLayout(graph, opts);
  }
  return createSyncFallbackLayout(graph, opts);
}

function createWorkerLayout(graph: Graph, opts?: { onConverged?: () => void }): FA2Controller {
  const settings = forceAtlas2.inferSettings(graph);
  const layout = new FA2Layout(graph, {
    settings: {
      ...settings,
      barnesHutOptimize: graph.order > 500,
    },
  });

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function scheduleSettle(ms: number) {
    clearSettle();
    settleTimer = setTimeout(() => {
      layout.stop();
      running = false;
      opts?.onConverged?.();
    }, ms);
  }

  function clearSettle() {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      layout.start();
      scheduleSettle(SETTLE_TIMEOUT_MS);
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
    reheat(durationMs = REHEAT_DURATION_MS) {
      if (!running) {
        running = true;
        layout.start();
      }
      scheduleSettle(durationMs);
    },
    isRunning() {
      return running;
    },
  };
}

function createSyncFallbackLayout(
  graph: Graph,
  opts?: { onConverged?: () => void },
): FA2Controller {
  let raf: number | null = null;
  let running = false;
  let iterationsLeft = 0;
  const CHUNK = 10;

  const settings = forceAtlas2.inferSettings(graph);

  function tick() {
    if (iterationsLeft <= 0 || graph.order === 0) {
      running = false;
      opts?.onConverged?.();
      return;
    }
    const batch = Math.min(CHUNK, iterationsLeft);
    forceAtlas2.assign(graph, { iterations: batch, settings });
    iterationsLeft -= batch;
    raf = requestAnimationFrame(tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      iterationsLeft = Math.min(120, 40 + graph.order);
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      iterationsLeft = 0;
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    },
    kill() {
      this.stop();
    },
    reheat(durationMs = REHEAT_DURATION_MS) {
      iterationsLeft = Math.max(iterationsLeft, Math.floor((durationMs / SETTLE_TIMEOUT_MS) * 60));
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    },
    isRunning() {
      return running;
    },
  };
}
