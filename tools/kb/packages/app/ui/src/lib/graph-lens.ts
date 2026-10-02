/**
 * V0 graph-lens module — pure extract of {nodes, edges} from client DataScript
 * + wire nodes, driven by a graph view node's lens props.
 */
import type { BulletAppearance } from "@/lib/bullet-mode";
import { viewOptionOf, type NodeProps } from "@kb/model";
import type { WireNode } from "@kb/contracts";
import {
  DEFAULT_CLUSTER_BY,
  DEFAULT_RENDERER,
  decodeLensConfig,
  type EdgeKind,
  type LensPerspective,
  type LensProps,
} from "@kb/views";
import type { KbIndex } from "@/ds";
import { nodeMentions, queryFamilyViewNodes, runQuery } from "@/ds";
import {
  UNTAGGED_COLOR,
  hashTagColor,
  tagColorOf,
  tagPalette,
  type TagPalette,
} from "@/lib/tag-color";
import { graphDisplayText } from "./graph-label";
import { SYSTEM_IDS, isSysPrefixed } from "@/lib/types";
import { logWarn } from "@/lib/log";

export interface LensNode {
  id: string;
  label: string;
  color: string;
  size: number;
  clusterKey: string;
  /** Human presentation of the cluster identity, resolved before renderer projection. */
  clusterLabel?: string;
  tags: string[];
  tagIds?: string[];
  degree: number;
  weight?: number;
  colorKey?: string;
  colorLabel?: string;
  /** The bullet the outline draws for this node, where a renderer draws it so (`lib/bullet-mode`). */
  bullet?: BulletAppearance;
}

export interface LensEdge {
  source: string;
  target: string;
  kind: EdgeKind;
  weight: number;
}

export interface LensGraph {
  nodes: LensNode[];
  edges: LensEdge[];
  /** Nodes dropped by max-nodes cap. */
  dropped: number;
  /** Query parse/exec error message, if any. */
  queryError: string | null;
}

function isTagNode(node: WireNode | undefined): boolean {
  if (!node) return false;
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  return types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.tag);
}

/** First content tag (skips sys.tag / sys.field type markers). */
/** `byId` is the whole workspace graph, so the default palette is its palette. */
export function firstTagOf(
  wire: WireNode,
  byId: Map<string, WireNode>,
  palette: TagPalette = tagPalette(byId),
): { id: string; color: string } | null {
  const types = wire.props[SYSTEM_IDS.typeField] ?? [];
  for (const pv of types) {
    if (pv.t !== "ref") continue;
    if (pv.v === SYSTEM_IDS.tag || pv.v === SYSTEM_IDS.field) continue;
    const target = byId.get(pv.v);
    if (!isTagNode(target)) continue;
    return { id: pv.v, color: tagColorOf(pv.v, palette) };
  }
  return null;
}

/**
 * The graphs: the view nodes whose view is a renderer, by the query that says
 * so (`familyViewNodesQuery`), in label order. None while the index loads.
 */
export function listPerspectiveNodes(db: KbIndex | null, wireNodes: WireNode[]): WireNode[] {
  if (db === null) return [];
  const ids = new Set(queryFamilyViewNodes(db, "graph.renderer"));
  return wireNodes
    .filter((node) => ids.has(node.id))
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
}

/**
 * Decode a graph view node: a view node whose view is a renderer. The
 * renderer is its view (`sys.f.view`); every other lens prop is decoded by
 * its slot.
 *
 * A malformed lens prop falls back to the slot's declared default and is
 * reported through the ui log seam; it never fails the perspective, because a
 * bad prop must not make the graph unopenable.
 */
export function parsePerspective(node: WireNode): LensPerspective {
  return {
    id: node.id,
    label: node.text.trim() || "Untitled",
    ...lensConfig(node.props, node.id),
    renderer: viewOptionOf(node) ?? DEFAULT_RENDERER,
  };
}

/**
 * The lens a node's props declare (`@kb/views`' `decodeLensConfig`), with
 * what it had to ignore reported through the ui log seam. `subject` names the
 * node in what the log reports.
 */
export function lensConfig(props: NodeProps, subject = ""): LensProps {
  return decodeLensConfig(props, lensReport(subject));
}

/** Where a lens prop the UI had to ignore goes: the log, naming `subject`. */
export function lensReport(subject = ""): (warning: string) => void {
  return (warning) => logWarn(`[graph-lens] ${subject === "" ? "" : `${subject}: `}${warning}`);
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
    asked ??
    perspectives.find((p) => p.id === SYSTEM_IDS.lensAllMentions) ??
    perspectives[0] ??
    null
  );
}

/** parentOf map from children[] within an optional id set. */
export function buildParentMap(wireNodes: WireNode[], nodeSet?: Set<string>): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const n of wireNodes) {
    if (nodeSet && !nodeSet.has(n.id)) continue;
    for (const child of n.children) {
      if (nodeSet && !nodeSet.has(child)) continue;
      if (!parentOf.has(child)) parentOf.set(child, n.id);
    }
  }
  return parentOf;
}

/**
 * Resolve cluster key for a node.
 * Modes: `tag:<id>` | `prop:<id>` | `parent` | `none` (default).
 */
interface LensCluster {
  key: string;
  label: string;
}

function resolveCluster(
  wire: WireNode,
  byId: Map<string, WireNode>,
  parentOf: Map<string, string>,
  clusterBy: string,
): LensCluster {
  const none = { key: "none", label: "All nodes" };
  const untagged = { key: "untagged", label: "Untagged" };
  const node = (id: string): LensCluster => ({
    key: id,
    label: graphDisplayText(byId.get(id)?.text ?? "", (ref) => byId.get(ref)?.text),
  });
  const mode = (clusterBy || DEFAULT_CLUSTER_BY).trim();
  if (mode === "tag") {
    const tag = firstTagOf(wire, byId);
    return tag ? node(tag.id) : untagged;
  }
  if (mode === "parent") {
    const parent = parentOf.get(wire.id);
    return parent !== undefined ? node(parent) : { key: "root", label: "Top level" };
  }
  if (mode.startsWith("tag:")) {
    const id = mode.slice(4).trim();
    return id && (wire.props[SYSTEM_IDS.typeField] ?? []).some((v) => v.t === "ref" && v.v === id)
      ? node(id)
      : untagged;
  }
  if (mode.startsWith("prop:")) {
    const values = wire.props[mode.slice(5).trim()] ?? [];
    const ref = values.find((v) => v.t === "ref");
    if (ref) return node(ref.v);
    const value = values[0];
    return value
      ? { key: `${value.t}:${String(value.v)}`, label: String(value.v) || "Untitled" }
      : none;
  }
  return none;
}

/** Identity lookup remains available to callers that do not render a label. */
export function resolveClusterKey(
  wire: WireNode,
  byId: Map<string, WireNode>,
  parentOf: Map<string, string>,
  clusterBy: string,
): string {
  return resolveCluster(wire, byId, parentOf, clusterBy).key;
}

export interface LensTreeNode {
  id: string;
  label: string;
  color: string;
  size: number;
  children: LensTreeNode[];
}

/**
 * Build a cycle-safe forest (or single tree when focus is set) over
 * children[] restricted to the lens node set.
 */
export function buildTreeForest(
  lensNodes: LensNode[],
  edges: LensEdge[],
  focusId: string | null,
): LensTreeNode[] {
  const byLens = new Map(lensNodes.map((n) => [n.id, n]));
  const children = new Map<string, Set<string>>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    if (!byLens.has(edge.source) || !byLens.has(edge.target)) continue;
    const list = children.get(edge.source) ?? new Set<string>();
    list.add(edge.target);
    children.set(edge.source, list);
    hasParent.add(edge.target);
  }
  // A tree is a spanning projection: shared descendants occur once, cycles keep
  // a deterministic root, and the underlying relationships remain intact.
  const seen = new Set<string>();
  const build = (id: string): LensTreeNode | null => {
    if (seen.has(id)) return null;
    const meta = byLens.get(id);
    if (!meta) return null;
    seen.add(id);
    return {
      id,
      label: meta.label,
      color: meta.color,
      size: meta.size,
      children: [...(children.get(id) ?? [])].map(build).filter((n): n is LensTreeNode => !!n),
    };
  };
  if (focusId !== null && byLens.has(focusId)) {
    const root = build(focusId);
    return root ? [root] : [];
  }
  const ids = [...byLens.keys()].toSorted();
  return [...ids.filter((id) => !hasParent.has(id)), ...ids]
    .map(build)
    .filter((n): n is LensTreeNode => !!n);
}

/** Collect node ids from a datalog result set (first string column per row). */
export function idsFromQueryRows(rows: unknown[][], known: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const id = row.find((v): v is string => typeof v === "string" && known.has(v));
    if (id !== undefined) out.add(id);
  }
  return out;
}

/**
 * Smart-elide targets: sys.* ids, #command nodes, and tag/field template
 * nodes (schema), so default empty-query lenses paint content — not scaffolding.
 */
export function isElidedSchemaNode(wire: WireNode): boolean {
  if (isSysPrefixed(wire.id)) return true;
  const types = wire.props[SYSTEM_IDS.typeField] ?? [];
  for (const v of types) {
    if (v.t !== "ref") continue;
    if (v.v === SYSTEM_IDS.command || v.v === SYSTEM_IDS.field || v.v === SYSTEM_IDS.tag) {
      return true;
    }
  }
  return false;
}

export interface ExtractLensOptions {
  /** When true, keep sys/command/schema nodes. Default false (smart-elide). */
  includeSystemNodes?: boolean;
  /**
   * Ontology scope: intersect the lens node set with these ids, so the graph
   * shows member nodes and their internal connections only. No new renderer —
   * an ontology is just another way of producing the node set (r5 §1.6).
   */
  restrictTo?: Set<string>;
}

function resolveNodeSet(
  db: KbIndex,
  wireNodes: WireNode[],
  perspective: LensPerspective,
  opts: ExtractLensOptions = {},
): { nodeSet: Set<string>; queryError: string | null } {
  const includeSystem = opts.includeSystemNodes === true;
  const restrictTo = opts.restrictTo;
  const candidates = wireNodes.filter((n) => {
    if (restrictTo && !restrictTo.has(n.id)) return false;
    return includeSystem || !isElidedSchemaNode(n);
  });
  const all = new Set(candidates.map((n) => n.id));
  const edn = perspective.query.trim();
  if (!edn) return { nodeSet: all, queryError: null };
  try {
    const rows = runQuery(db, edn);
    return { nodeSet: idsFromQueryRows(rows, all), queryError: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWarn("[graph-lens] lens.query failed:", msg);
    return { nodeSet: new Set(), queryError: msg };
  }
}

function collectEdges(
  wireNodes: WireNode[],
  nodeSet: Set<string>,
  kinds: Set<EdgeKind>,
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
   * read from its own carrier and they stay disjoint: text tokens here (the
   * node's text and its text values, `nodeMentions`), the
   * children array below, ref prop values after that. `:node/mentions` is
   * deliberately NOT used — it is carrier-independent (see ds/datoms), so
   * querying it would double every ref-prop edge as a mention as well.
   */
  if (kinds.has("mention")) {
    for (const n of wireNodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const to of new Set(nodeMentions(n))) {
        push(n.id, to, "mention");
      }
    }
  }

  if (kinds.has("child")) {
    for (const n of wireNodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const child of n.children) {
        push(n.id, child, "child");
      }
    }
  }

  if (kinds.has("ref-prop") || [...kinds].some((kind) => kind.startsWith("prop:"))) {
    for (const n of wireNodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const [field, values] of Object.entries(n.props)) {
        if (!kinds.has("ref-prop") && !kinds.has(`prop:${field}`)) continue;
        for (const pv of values) {
          if (pv.t === "ref") push(n.id, pv.v, `prop:${field}`);
        }
      }
    }
  }

  return edges;
}

function degreeMap(nodeIds: Iterable<string>, edges: LensEdge[]): Map<string, number> {
  const deg = new Map<string, number>();
  for (const id of nodeIds) deg.set(id, 0);
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return deg;
}

function applyMaxNodesCap(
  nodeIds: string[],
  degrees: Map<string, number>,
  maxNodes: number,
): { keep: Set<string>; dropped: number } {
  if (nodeIds.length <= maxNodes) {
    return { keep: new Set(nodeIds), dropped: 0 };
  }
  const ranked = [...nodeIds].toSorted((a, b) => {
    const d = (degrees.get(b) ?? 0) - (degrees.get(a) ?? 0);
    if (d !== 0) return d;
    return a.localeCompare(b);
  });
  const keep = new Set(ranked.slice(0, maxNodes));
  const dropped = nodeIds.length - maxNodes;
  logWarn(`[graph-lens] max-nodes=${maxNodes}: dropped ${dropped} lowest-degree nodes`);
  return { keep, dropped };
}

export function resolveColor(
  wire: WireNode,
  byId: Map<string, WireNode>,
  colorBy: string,
  parentOf = buildParentMap([...byId.values()]),
  palette: TagPalette = tagPalette(byId),
): string {
  if (colorBy.startsWith("fixed:")) {
    const hex = colorBy.slice("fixed:".length).trim() || "#888888";
    return hex;
  }
  if (colorBy.startsWith("prop:") || colorBy === "parent" || colorBy === "none") {
    return hashTagColor(resolveCluster(wire, byId, parentOf, colorBy).key);
  }
  // default: tag
  return firstTagOf(wire, byId, palette)?.color ?? UNTAGGED_COLOR;
}

export function resolveSize(sizeBy: string, degree: number, childCount: number): number {
  if (sizeBy === "fixed") return 5;
  if (sizeBy === "children") {
    return Math.max(3, Math.min(20, 3 + Math.sqrt(childCount) * 2.5));
  }
  // degree (default)
  return Math.max(3, Math.min(20, 3 + Math.sqrt(degree) * 2.5));
}

function resolveMeasure(wire: WireNode, sizeBy: string, degree: number): number {
  if (sizeBy.startsWith("prop:"))
    return Math.max(
      0,
      (wire.props[sizeBy.slice(5)] ?? []).reduce(
        (sum, value) => sum + (value.t === "num" && Number.isFinite(value.v) ? value.v : 0),
        0,
      ),
    );
  if (sizeBy === "fixed") return 1;
  return sizeBy === "children" ? wire.children.length : degree;
}

export function extractLensGraph(
  db: KbIndex,
  wireNodes: WireNode[],
  perspective: LensPerspective,
  opts: ExtractLensOptions = {},
): LensGraph {
  const byId = new Map(wireNodes.map((n) => [n.id, n]));
  const { nodeSet, queryError } = resolveNodeSet(db, wireNodes, perspective, opts);
  const kinds = new Set(perspective.edgeKinds);
  const rawEdges = collectEdges(wireNodes, nodeSet, kinds);
  const candidateIds = [...nodeSet];
  const degrees = degreeMap(candidateIds, rawEdges);
  const { keep, dropped } = applyMaxNodesCap(candidateIds, degrees, perspective.maxNodes);
  const edges = rawEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
  const finalDegrees = degreeMap(keep, edges);

  const parentOf = buildParentMap(wireNodes, keep);
  const palette = tagPalette(wireNodes);
  const nodes: LensNode[] = [];
  for (const id of keep) {
    const wire = byId.get(id);
    if (!wire) continue;
    const color = resolveColor(wire, byId, perspective.colorBy, parentOf, palette);
    const cluster = resolveCluster(wire, byId, parentOf, perspective.clusterBy);
    const weight = resolveMeasure(wire, perspective.sizeBy, finalDegrees.get(id) ?? 0);
    const size = perspective.sizeBy.startsWith("prop:")
      ? Math.max(3, Math.min(20, 3 + Math.sqrt(weight) * 2.5))
      : resolveSize(perspective.sizeBy, finalDegrees.get(id) ?? 0, wire.children.length);
    const category = resolveCluster(
      wire,
      byId,
      parentOf,
      perspective.colorBy.startsWith("fixed:") ? "none" : perspective.colorBy,
    );
    const labelValues =
      perspective.labelBy?.startsWith("prop:") === true
        ? (wire.props[perspective.labelBy.slice(5)] ?? [])
        : [];
    const label = labelValues
      .map((value) =>
        value.t === "ref" ? graphDisplayText(byId.get(value.v)?.text ?? "") : String(value.v),
      )
      .filter(Boolean)
      .join(", ");
    const wireTags: string[] = [];
    const tagIds: string[] = [];
    const types = wire.props[SYSTEM_IDS.typeField] ?? [];
    for (const pv of types) {
      if (pv.t === "ref") {
        const target = byId.get(pv.v);
        if (target && isTagNode(target)) {
          wireTags.push(graphDisplayText(target.text, (ref) => byId.get(ref)?.text));
          tagIds.push(target.id);
        }
      }
    }
    nodes.push({
      id,
      label: label || graphDisplayText(wire.text, (ref) => byId.get(ref)?.text),
      color,
      size,
      weight,
      colorKey: category.key,
      colorLabel: category.label,
      clusterKey: cluster.key,
      clusterLabel: cluster.label,
      tags: wireTags,
      tagIds,
      degree: finalDegrees.get(id) ?? 0,
    });
  }
  return { nodes: nodes.toSorted((a, b) => a.id.localeCompare(b.id)), edges, dropped, queryError };
}
