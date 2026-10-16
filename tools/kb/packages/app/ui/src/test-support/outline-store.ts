import { providePageProjection } from "@/stores/graph.store";
import { providePageEditor } from "@/stores/page-editor";
import { resetGraphStore } from "./graph-store";
import {
  initialOutlineState,
  outlineProjection,
  type OutlineStateData,
  useOutlineStore,
} from "@kb/outline-ui";

/**
 * Reset to a fresh clone of `initialOutlineState`, then apply test overrides.
 * The outline's rows are read from the graph store and its own state follows
 * the graph's moves, so it is reset on a fresh graph and installed as the
 * page's projection and editor, as the outline plugin installs it in the page.
 * The install is idempotent, so a reset per test installs it once. It is
 * contained to the test file: each file has its own module registry, so its
 * graph store, and the projection installed on it, are the file's own.
 */
export function resetOutlineStore(overrides?: Partial<OutlineStateData>): void {
  resetGraphStore();
  providePageProjection(outlineProjection);
  providePageEditor(useOutlineStore);
  useOutlineStore.setState({
    ...structuredClone(initialOutlineState),
    ...overrides,
  });
}
