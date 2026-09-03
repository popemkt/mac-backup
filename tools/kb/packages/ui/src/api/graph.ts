import { GraphSnapshotSchema, type GraphSnapshot } from "@kb/contracts";
import { fixtureGraph } from "@/fixtures/graph";

export type GraphLoadSource = "api" | "fixtures";

export interface GraphLoadResult {
  snapshot: GraphSnapshot;
  source: GraphLoadSource;
}

export type FetchGraphSnapshotFn = () => Promise<GraphSnapshot>;

function useFixturesForced(): boolean {
  return (
    import.meta.env.VITE_USE_FIXTURES === "1" ||
    import.meta.env.VITE_USE_FIXTURES === "true"
  );
}

function validatedFixtures(): GraphSnapshot {
  return GraphSnapshotSchema.parse(fixtureGraph);
}

async function defaultFetchGraphSnapshot(): Promise<GraphSnapshot> {
  if (useFixturesForced()) {
    return validatedFixtures();
  }

  const res = await fetch("/api/graph");
  if (!res.ok) throw new Error(`GET /api/graph → ${res.status}`);
  const json: unknown = await res.json();
  return GraphSnapshotSchema.parse(json);
}

let fetchGraphSnapshotImpl: FetchGraphSnapshotFn = defaultFetchGraphSnapshot;

/** Inject a mock for tests (mirrors setPostAction). */
export function setFetchGraphSnapshot(fn: FetchGraphSnapshotFn | null): void {
  fetchGraphSnapshotImpl = fn ?? defaultFetchGraphSnapshot;
}

/**
 * Strict GET /api/graph — throws on failure, never returns demo fixtures.
 * Use for mid-session resync / optimistic recovery. Fixture mode is honored
 * only when VITE_USE_FIXTURES is forced.
 */
export function fetchGraphSnapshot(): Promise<GraphSnapshot> {
  return fetchGraphSnapshotImpl();
}

/** Cold-boot load: GET /api/graph, fall back to fixtures when offline. */
export async function loadGraph(): Promise<GraphLoadResult> {
  if (useFixturesForced()) {
    return { snapshot: validatedFixtures(), source: "fixtures" };
  }

  try {
    const snapshot = await fetchGraphSnapshot();
    return { snapshot, source: "api" };
  } catch {
    return { snapshot: validatedFixtures(), source: "fixtures" };
  }
}
