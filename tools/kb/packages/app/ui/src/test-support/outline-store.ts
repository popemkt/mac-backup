import {
  initialOutlineState,
  useOutlineStore,
  type OutlineStateData,
} from "@/stores/outline.store";
import { resetGraphStore } from "./graph-store";

/**
 * Reset to a fresh clone of `initialOutlineState`, then apply test overrides.
 * The outline derives from the graph store, so it is reset on a fresh graph.
 */
export function resetOutlineStore(overrides?: Partial<OutlineStateData>): void {
  resetGraphStore();
  useOutlineStore.setState({
    ...structuredClone(initialOutlineState),
    ...overrides,
  });
}
