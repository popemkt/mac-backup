/**
 * The graph family's settings, read off its extension node
 * (`sys.extension.graph`), where they are written like any field.
 */
import { firstBool } from "@kb/model";
import type { LensSource } from "./edges.ts";
import { GRAPH_IDS } from "./ids.ts";

/** Whether the graph and the outline offer relations to type; off when the node says nothing. */
export function suggestsRelations(extensionNode: Pick<LensSource, "props"> | undefined): boolean {
  return extensionNode === undefined
    ? false
    : firstBool(GRAPH_IDS.suggestRelationsField)(extensionNode.props) === true;
}
