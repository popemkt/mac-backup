/**
 * Trace and suggest as a host answers them: over the nodes a host holds,
 * walking only those it shows (`within`, the visible ones), with every hop
 * worded and every node named from all it holds — a relation's field is
 * scaffolding the walk never crosses, yet it names the hop. The server's
 * actions (`graph.trace`, `graph.suggest`) and the page's local read run
 * these same functions, so both hosts give one answer.
 */
import { relationInverseOf, replaceMentions } from "@kb/model";
import type { LensSource } from "./edges.ts";
import { explainHop, hopLabel, type HopLabels } from "./explain.ts";
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

/** The nodes a read may walk, by id; absent, every node it is given. */
interface WithinRequest {
  readonly within?: ReadonlySet<string>;
}

export interface TraceRequest extends TraceOptions, WithinRequest {
  readonly from: string;
  readonly to: string;
  readonly kinds?: readonly EdgeKind[];
}

/** The nodes among `nodes` a read walks: those `within` names, or all of them. */
function walked(nodes: readonly LensSource[], within: ReadonlySet<string> | undefined) {
  return within === undefined ? nodes : nodes.filter((node) => within.has(node.id));
}

export function traceOf(nodes: readonly LensSource[], request: TraceRequest): TraceAnswer {
  const { from, to, kinds = DEFAULT_TRACE_KINDS, within, ...options } = request;
  const labels = hopLabelsOf(nodes);
  const result = trace(projectionOf(walked(nodes, within), new Set(kinds)), from, to, options);
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
  return suggest(projectionOf(walked(nodes, within), new Set(kinds)), id, options).map((s) => ({
    ...s,
    text: labels.textOf(s.id),
  }));
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
