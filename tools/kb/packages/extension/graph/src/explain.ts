/**
 * A hop in words. The built-in kinds read as verbs ("A mentions B", "B
 * contains C"); a typed relation reads as its field, the field node's text,
 * drawn as an arrow ("C —influences→ D"). Read against its direction, a
 * typed relation uses the field's inverse label when it has one ("D
 * ←influenced by— E"), and its own label otherwise.
 */
import type { LensEdge } from "./edges.ts";
import type { TraceHop } from "./trace.ts";

/** What a relation is called: a field node's text, and its inverse label when it has one. */
export interface RelationLabel {
  readonly label: string;
  readonly inverse: string | null;
}

/** What an explanation reads of the store: a node's display text and a relation field's labels. */
export interface HopLabels {
  readonly textOf: (id: string) => string;
  readonly relationOf: (fieldId: string) => RelationLabel;
}

/** A relation as a sentence reads it: a built-in kind is a verb, a field an arrow. */
export interface Relation extends RelationLabel {
  readonly form: "verb" | "arrow";
}

const VERBS: Record<"mention" | "child", Relation> = {
  mention: { label: "mentions", inverse: "is mentioned by", form: "verb" },
  child: { label: "contains", inverse: "is inside", form: "verb" },
};

/** The relation an edge is: a built-in verb, or the field its kind names. */
export function relationOfEdge(edge: LensEdge, labels: HopLabels): Relation {
  if (edge.kind === "mention" || edge.kind === "child") return VERBS[edge.kind];
  return { ...labels.relationOf(edge.kind.slice("prop:".length)), form: "arrow" };
}

/** What a hop is called, read the way the path walks it. */
export function hopLabel(hop: TraceHop, labels: HopLabels): string {
  const relation = relationOfEdge(hop.edge, labels);
  return hop.edge.source === hop.from ? relation.label : (relation.inverse ?? relation.label);
}

export function explainHop(hop: TraceHop, labels: HopLabels): string {
  const from = labels.textOf(hop.from);
  const to = labels.textOf(hop.to);
  const forward = hop.edge.source === hop.from;
  const relation = relationOfEdge(hop.edge, labels);
  if (relation.form === "verb")
    return `${from} ${forward ? relation.label : (relation.inverse ?? relation.label)} ${to}`;
  if (forward) return `${from} —${relation.label}→ ${to}`;
  return `${to} —${relation.label}→ ${from}, read back as ${from} ←${relation.inverse ?? relation.label}— ${to}`;
}
