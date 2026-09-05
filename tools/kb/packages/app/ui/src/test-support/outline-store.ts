import {
  initialOutlineState,
  useOutlineStore,
  type OutlineStateData,
} from "@/stores/outline.store";

/** Reset to a fresh clone of `initialOutlineState`, then apply test overrides. */
export function resetOutlineStore(overrides?: Partial<OutlineStateData>): void {
  useOutlineStore.setState({
    ...structuredClone(initialOutlineState),
    ...overrides,
  });
}
