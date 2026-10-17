/**
 * "Related, not connected" (DESIGN-UI.md → Graph → Suggestions): with the
 * family's setting on (`graph.suggest-relations` on `sys.extension.graph`),
 * the selection card lists the drawn nodes the lens's kinds do not connect
 * to the selection but whose structure says they relate, `@kb/graph`'s
 * `suggestOf` over the nodes drawn, the read the server's `graph.suggest`
 * runs. Each row's "Link as…" types the relation (`graph.relation.type`)
 * as a ref field that allows the target.
 */
import { useMemo } from "react";
import type { WireNode } from "@kb/contracts";
import {
  relationFieldsFor,
  suggestOf,
  suggestsRelations,
  type LensPerspective,
  type SuggestedNode,
} from "@kb/graph";
import { extensionNodeId } from "@kb/model";
import { browserHost, runQuery, type KbIndex } from "@kb/ui-sdk";
import type { GraphLens } from "./graph-lens";

/** How many suggestions the card lists. */
const RELATED_LIMIT = 5;

/** A related row's typing: the ref fields that allow its target, and the write. */
interface RelatedTyping {
  readonly fieldsFor: (target: string) => readonly { readonly id: string; readonly text: string }[];
  readonly link: (target: string, field: string) => Promise<boolean>;
}

export interface Related {
  readonly suggestions: readonly SuggestedNode[];
  readonly typing: RelatedTyping;
}

/** The selection's related nodes, or null while the setting is off or nothing is selected. */
export function useRelated(
  db: KbIndex | null,
  perspective: LensPerspective | null,
  lensGraph: GraphLens,
  wireNodes: readonly WireNode[],
  selectedId: string | null,
): Related | null {
  const on = suggestsRelations(wireNodes.find((node) => node.id === extensionNodeId("graph")));
  return useMemo(() => {
    if (!on || db === null || perspective === null || selectedId === null) return null;
    const drawn = new Set(lensGraph.nodes.map((node) => node.id));
    const suggestions = suggestOf(wireNodes, {
      id: selectedId,
      within: drawn,
      kinds: perspective.edgeKinds,
      limit: RELATED_LIMIT,
    });
    const byId = new Map(wireNodes.map((node) => [node.id, node]));
    return {
      suggestions,
      typing: {
        fieldsFor: (target) => relationFieldsFor(byId, target, (edn) => runQuery(db, edn)),
        link: async (target, field) => {
          const receipt = await browserHost().invoke("graph.relation.type", {
            source: selectedId,
            target,
            field,
          });
          return receipt.status === "succeeded";
        },
      },
    };
  }, [on, db, perspective, lensGraph.nodes, wireNodes, selectedId]);
}
