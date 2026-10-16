import { initialGraphState, replaceGraph, type GraphStateData } from "@/stores/graph.store";

/**
 * Reset to a fresh clone of `initialGraphState`, then apply test overrides —
 * as a load, so a projection deriving from the graph follows it.
 */
export function resetGraphStore(overrides?: Partial<GraphStateData>): void {
  replaceGraph({ ...structuredClone(initialGraphState), ...overrides });
}
