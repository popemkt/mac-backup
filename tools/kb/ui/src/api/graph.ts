import { GraphSnapshotSchema, type GraphSnapshot } from "@kb/protocol";
import { fixtureGraph } from "@/fixtures/graph";

export type GraphLoadSource = "api" | "fixtures";

export interface GraphLoadResult {
  snapshot: GraphSnapshot;
  source: GraphLoadSource;
}

function useFixturesForced(): boolean {
  return (
    import.meta.env.VITE_USE_FIXTURES === "1" ||
    import.meta.env.VITE_USE_FIXTURES === "true"
  );
}

function validatedFixtures(): GraphSnapshot {
  return GraphSnapshotSchema.parse(fixtureGraph);
}

/** Load GET /api/graph; fall back to protocol-shaped fixtures when offline. */
export async function loadGraph(): Promise<GraphLoadResult> {
  if (useFixturesForced()) {
    return { snapshot: validatedFixtures(), source: "fixtures" };
  }

  try {
    const res = await fetch("/api/graph");
    if (!res.ok) throw new Error(`GET /api/graph → ${res.status}`);
    const json: unknown = await res.json();
    const snapshot = GraphSnapshotSchema.parse(json);
    return { snapshot, source: "api" };
  } catch {
    return { snapshot: validatedFixtures(), source: "fixtures" };
  }
}
