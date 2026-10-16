/**
 * A graph perspective: a view node whose view is a renderer, read as the
 * lens it draws (DESIGN-UI.md → Field-based graph perspectives).
 */
import { viewOptionOf, type KbNode } from "@kb/model";
import type { ConfigReport } from "@kb/views";
import { DEFAULT_RENDERER, decodeLensConfig, type LensPerspective } from "./lens.ts";
import { GRAPH_IDS } from "./ids.ts";

/**
 * Decode a graph view node. The renderer is its view (`sys.f.view`); every
 * other lens prop is decoded by its slot (`decodeLensConfig`).
 *
 * A malformed lens prop falls back to the slot's declared default and is
 * handed to `report`; it never fails the perspective, because a bad prop
 * must not make the graph unopenable.
 */
export function decodePerspective(
  node: Pick<KbNode, "id" | "text" | "props">,
  report: ConfigReport,
): LensPerspective {
  return {
    id: node.id,
    label: node.text.trim() || "Untitled",
    ...decodeLensConfig(node.props, report),
    renderer: viewOptionOf(node) ?? DEFAULT_RENDERER,
  };
}

/**
 * The perspective a graph shows when asked for `id`: that one if it exists,
 * else the seeded all-mentions lens, else the first there is.
 */
export function resolvePerspective(
  perspectives: readonly LensPerspective[],
  id: string | null,
): LensPerspective | null {
  const asked = id === null ? undefined : perspectives.find((p) => p.id === id);
  return (
    asked ?? perspectives.find((p) => p.id === GRAPH_IDS.lensAllMentions) ?? perspectives[0] ?? null
  );
}
