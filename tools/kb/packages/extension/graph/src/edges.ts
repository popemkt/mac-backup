/**
 * The graph's edge projection: the edges of a node set, by kind. One
 * function every surface reads, so a renderer, the page's lens and a read on
 * the server draw the same edges from the same nodes.
 */
import type { KbNode } from "@kb/model";
import { nodeMentions } from "@kb/query";
import type { EdgeKind } from "./lens.ts";

/** What the projection reads of a node: a stored node and a wire node both are one. */
export type LensSource = Pick<KbNode, "id" | "text" | "props" | "children">;

/** One edge of the projection; parallel edges of one kind are one edge with their count as its weight. */
export interface LensEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
  /**
   * Set when the edge carries a mention folded into a typed relation: the
   * source both mentions the target and holds it in a ref field, and the
   * relation says what the mention means.
   */
  carriers?: readonly ["mention", "prop"];
}

/**
 * The edges among `nodeSet` of the kinds in `kinds`, read from `nodes`: an
 * edge whose ends are not both in the set, or that loops onto its source, is
 * not drawn.
 */
export function collectEdges(
  nodes: readonly LensSource[],
  nodeSet: ReadonlySet<string>,
  kinds: ReadonlySet<EdgeKind>,
): LensEdge[] {
  const edges: LensEdge[] = [];
  const weights = new Map<string, number>();
  const push = (source: string, target: string, kind: EdgeKind) => {
    if (!nodeSet.has(source) || !nodeSet.has(target)) return;
    if (source === target) return;
    const key = `${kind}:${source}->${target}`;
    const existing = weights.get(key);
    if (existing !== undefined) {
      weights.set(key, existing + 1);
      const edge = edges.find((e) => e.source === source && e.target === target && e.kind === kind);
      if (edge) edge.weight = existing + 1;
      return;
    }
    weights.set(key, 1);
    edges.push({ source, target, kind, weight: 1 });
  };

  /*
   * The three edge kinds are provenance lenses over one relation, so each is
   * read from its own carrier: text tokens here (the node's text and its
   * text values, `nodeMentions`), the children array below, ref prop values
   * after that. `:node/mentions` is deliberately NOT used — it is
   * carrier-independent (see ds/datoms), so querying it would double every
   * ref-prop edge as a mention as well. The one place two carriers meet is
   * a typed mention, folded at the end.
   */
  if (kinds.has("mention")) {
    for (const n of nodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const to of new Set(nodeMentions(n))) {
        push(n.id, to, "mention");
      }
    }
  }

  if (kinds.has("child")) {
    for (const n of nodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const child of n.children) {
        push(n.id, child, "child");
      }
    }
  }

  if (kinds.has("ref-prop") || [...kinds].some((kind) => kind.startsWith("prop:"))) {
    for (const n of nodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const [field, values] of Object.entries(n.props)) {
        if (!kinds.has("ref-prop") && !kinds.has(`prop:${field}`)) continue;
        for (const pv of values) {
          if (pv.t === "ref") push(n.id, pv.v, `prop:${field}`);
        }
      }
    }
  }

  return foldTypedMentions(edges);
}

/**
 * A mention the source has also typed (it holds the target in a ref field)
 * is one connection, not two: the mention folds into the first typed
 * relation to that target, raising its weight by the mention's and marking
 * its carriers. A lens that draws mentions but not that field keeps the
 * mention as it is, because nothing here says what it means.
 */
function foldTypedMentions(edges: LensEdge[]): LensEdge[] {
  const mentions = new Map<string, LensEdge>();
  for (const edge of edges)
    if (edge.kind === "mention") mentions.set(`${edge.source}->${edge.target}`, edge);
  const folded = new Set<LensEdge>();
  for (const edge of edges) {
    if (!edge.kind.startsWith("prop:")) continue;
    const mention = mentions.get(`${edge.source}->${edge.target}`);
    if (mention === undefined || folded.has(mention)) continue;
    folded.add(mention);
    edge.weight += mention.weight;
    edge.carriers = ["mention", "prop"];
  }
  return folded.size === 0 ? edges : edges.filter((edge) => !folded.has(edge));
}
