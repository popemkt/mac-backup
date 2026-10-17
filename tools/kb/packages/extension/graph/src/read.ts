/**
 * Trace, suggest and the edges among a set as a host answers them: over the
 * nodes a host holds, walking only those it shows (`within`, the visible
 * ones) and the nodes a trace or suggestion is anchored at (a trace's ends,
 * a suggestion's subject), whatever they are, so a read that names a
 * scaffolding node starts there on every host. Every hop is
 * worded and every node named from all it holds — a relation's field is
 * scaffolding the walk never crosses, yet it names the hop. The server's
 * actions (`graph.trace`, `graph.suggest`) and the page's local read run
 * these same functions, so both hosts give one answer.
 */
import { relationInverseOf, replaceMentions } from "@kb/model";
import { collectEdges, type LensEdge, type LensSource } from "./edges.ts";
import { explainHop, hopLabel, relationOfEdge, type HopLabels } from "./explain.ts";
import type { EdgeKind } from "./lens.ts";
import { projectionOf } from "./projection.ts";
import { suggest, type SuggestOptions, type SuggestReasons } from "./suggest.ts";
import { trace, type TraceOptions, type TraceReason } from "./trace.ts";

/**
 * What a trace walks when it names no kinds: every relationship the graph
 * draws, typed relations included, because a trace looks for connections a
 * single lens may not show.
 */
export const DEFAULT_TRACE_KINDS: readonly EdgeKind[] = ["mention", "child", "ref-prop"];

/** A hop as a reader reads it: which way its edge points, what it is called, and the sentence it makes. */
export interface TracedHop {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  readonly forward: boolean;
  readonly label: string;
  readonly sentence: string;
}

export interface TracedPath {
  readonly nodes: readonly string[];
  readonly hops: readonly TracedHop[];
  readonly hubCost: number;
}

export interface TraceAnswer {
  readonly paths: readonly TracedPath[];
  readonly reason: TraceReason | null;
  readonly warnings: readonly string[];
}

/** The nodes a read may walk besides its anchors, by id; absent, every node it is given. */
interface WithinRequest {
  readonly within?: ReadonlySet<string>;
}

export interface TraceRequest extends TraceOptions, WithinRequest {
  readonly from: string;
  readonly to: string;
  readonly kinds?: readonly EdgeKind[];
}

/** The nodes among `nodes` a read walks: those `within` names and its `anchors`, or all of them. */
function walked(
  nodes: readonly LensSource[],
  within: ReadonlySet<string> | undefined,
  anchors: readonly string[],
) {
  if (within === undefined) return nodes;
  const kept = new Set([...within, ...anchors]);
  return nodes.filter((node) => kept.has(node.id));
}

export function traceOf(nodes: readonly LensSource[], request: TraceRequest): TraceAnswer {
  const { from, to, kinds = DEFAULT_TRACE_KINDS, within, ...options } = request;
  const labels = hopLabelsOf(nodes);
  const result = trace(
    projectionOf(walked(nodes, within, [from, to]), new Set(kinds)),
    from,
    to,
    options,
  );
  return {
    paths: result.paths.map((path) => ({
      nodes: path.nodes,
      hubCost: path.hubCost,
      hops: path.hops.map((hop) => ({
        from: hop.from,
        to: hop.to,
        kind: hop.edge.kind,
        forward: hop.edge.source === hop.from,
        label: hopLabel(hop, labels),
        sentence: explainHop(hop, labels),
      })),
    })),
    reason: result.reason,
    warnings: result.warnings,
  };
}

/** A suggestion as a reader reads it: the candidate named, its score and its reasons. */
export interface SuggestedNode {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly reasons: SuggestReasons;
}

export interface SuggestRequest extends SuggestOptions, WithinRequest {
  readonly id: string;
  readonly kinds?: readonly EdgeKind[];
}

export function suggestOf(
  nodes: readonly LensSource[],
  request: SuggestRequest,
): readonly SuggestedNode[] {
  const { id, kinds = DEFAULT_TRACE_KINDS, within, ...options } = request;
  const labels = hopLabelsOf(nodes);
  return suggest(projectionOf(walked(nodes, within, [id]), new Set(kinds)), id, options).map(
    (s) => ({
      ...s,
      text: labels.textOf(s.id),
    }),
  );
}

export interface EdgesRequest extends WithinRequest {
  readonly ids: readonly string[];
  readonly kinds?: readonly EdgeKind[];
}

/** An edge as a reader reads it: the projection's, named by its relation (`relationOfEdge`). */
export interface NamedEdge extends LensEdge {
  readonly label: string;
}

/** The ids a set keeps, and the edges among them. */
export interface EdgesAnswer {
  readonly nodes: readonly string[];
  readonly edges: readonly NamedEdge[];
}

/**
 * The edges among `ids`, as the projection draws them (`collectEdges`), each
 * named by its relation: of `ids`, only those `within` names are kept, once
 * each, in the order named, so what the graph elides draws no edge.
 */
export function edgesAmong(nodes: readonly LensSource[], request: EdgesRequest): EdgesAnswer {
  const { ids, kinds = DEFAULT_TRACE_KINDS, within } = request;
  const kept = [...new Set(ids)].filter((id) => within === undefined || within.has(id));
  const labels = hopLabelsOf(nodes);
  const edges = collectEdges(nodes, new Set(kept), new Set(kinds));
  return {
    nodes: kept,
    edges: edges.map((edge) => ({ ...edge, label: relationOfEdge(edge, labels).label })),
  };
}

/**
 * The labels a node set gives a hop: a node by its text, with each reference
 * token read as its label (or its target's text), and a relation by its
 * field node's text, read back by the field's inverse label when it has one.
 */
export function hopLabelsOf(nodes: readonly LensSource[]): HopLabels {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const textOf = (id: string): string => {
    const text = byId.get(id)?.text;
    if (text === undefined) return id;
    const plain = replaceMentions(text, (span) => span.label ?? byId.get(span.id)?.text ?? span.id);
    return plain.trim() === "" ? id : plain.trim();
  };
  return {
    textOf,
    relationOf: (fieldId) => ({
      label: textOf(fieldId),
      inverse: relationInverseOf(byId.get(fieldId)),
    }),
  };
}
