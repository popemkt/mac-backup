import { initialGraphState, useGraphStore, type GraphStateData } from "@/stores/graph.store";

/** Reset to a fresh clone of `initialGraphState`, then apply test overrides. */
export function resetGraphStore(overrides?: Partial<GraphStateData>): void {
  useGraphStore.setState({
    ...structuredClone(initialGraphState),
    ...overrides,
  });
}
