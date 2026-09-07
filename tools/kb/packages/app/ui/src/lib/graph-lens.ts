/**
 * V0 graph-lens module — pure extract of {nodes, edges} from client DataScript
 * + wire nodes, driven by a #graph-perspective node's lens props.
 */
import {
  GRAPH_RENDERER_VALUES,
  graphRendererKey,
  graphSourceKey,
  graphRendererId,
  graphSourceId,
} from "@kb/model";
import type { WireNode } from "@kb/contracts";
import type { KbIndex } from "@/ds";
import { extractMentions, runQuery } from "@/ds";
import { hashTagColor, resolveTagColor } from "@/lib/tag-color";
import { graphDisplayText } from "./graph-label";
import { SYSTEM_IDS, isSysPrefixed, type PropValue } from "@/lib/types";
import { logWarn } from "@/lib/log";

export type EdgeKind = "mention" | "child" | "ref-prop" | `prop:${string}`;

/**
 * The four renderers `LENS_RENDERERS` knows about, plus any other string:
 * a perspective's renderer is a free-form kb prop, not a closed enum.
 */
export type LensRenderer = (typeof LENS_RENDERERS)[number] | (string & {});

export type LensLayout = "force" | "radial" | "hierarchical" | "grid";
export type LensLabelDensity = "low" | "medium" | "high";

export interface LensPerspective {
  id: string;
  label: string;
  /** EDN datalog → node id set; empty/absent = all nodes. */
  query: string;
  renderer: LensRenderer;
  /** `tag` | `fixed:<hex>` */
  colorBy: string;
  labelBy?: string;
  /** `degree` | `children` | `fixed` */
  sizeBy: string;
  edgeKinds: EdgeKind[];
  maxNodes: number;
  /** `tag:<id>` | `prop:<id>` | `parent` | `none` */
  clusterBy: string;
  /** Tree / ego root node id when set. */
  focus: string | null;
  layout: LensLayout;
  spread: number;
  linkDistance: number;
  showLabels: boolean;
  curvedLinks: boolean;
  autorotate: boolean;
  labelDensity: LensLabelDensity;
}

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

export const DEFAULT_EDGE_KINDS: EdgeKind[] = ["mention", "child"];
export const DEFAULT_MAX_NODES = 500;
export const DEFAULT_COLOR_BY = "tag";
export const DEFAULT_SIZE_BY = "degree";
export const DEFAULT_RENDERER = "force2d";
/** Fallback when a perspective has no cluster-by prop. Seeded perspectives use `parent`. */
export const DEFAULT_CLUSTER_BY = "parent";
export const DEFAULT_LAYOUT: LensLayout = "force";
export const DEFAULT_SPREAD = 150;
export const DEFAULT_LINK_DISTANCE = 60;
export const DEFAULT_SHOW_LABELS = true;
export const DEFAULT_CURVED_LINKS = false;
export const DEFAULT_AUTOROTATE = false;
export const DEFAULT_LABEL_DENSITY: LensLabelDensity = "medium";

export const LENS_LAYOUTS: LensLayout[] = ["force", "radial", "hierarchical", "grid"];

const LENS_RENDERERS = Object.keys(GRAPH_RENDERER_VALUES);

const EDGE_KIND_SET = new Set<string>(["mention", "child", "ref-prop"]);

function strProp(node: WireNode, fieldId: string): string | null {
  const v = (node.props[fieldId] ?? []).find((p) => p.t === "str" && typeof p.v === "string");
  return v ? v.v.trim() : null;
}

function numProp(node: WireNode, fieldId: string): number | null {
  const v = (node.props[fieldId] ?? []).find((p) => p.t === "num" && typeof p.v === "number");
  return v ? v.v : null;
}

function refProp(node: WireNode, fieldId: string): string | null {
  const v = (node.props[fieldId] ?? []).find((p) => p.t === "ref" && typeof p.v === "string");
  return v ? v.v : null;
}

function isTagNode(node: WireNode | undefined): boolean {
  if (!node) return false;
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  return types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.tag);
}

/** First content tag (skips sys.tag / sys.field type markers). */
export function firstTagOf(
  wire: WireNode,
  byId: Map<string, WireNode>,
): { id: string; color: string } | null {
  const types = wire.props[SYSTEM_IDS.typeField] ?? [];
  for (const pv of types) {
    if (pv.t !== "ref") continue;
    if (pv.v === SYSTEM_IDS.tag || pv.v === SYSTEM_IDS.field) continue;
    const target = byId.get(pv.v);
    if (!isTagNode(target)) continue;
    const colorProp = target?.props[SYSTEM_IDS.colorField]?.[0];
    const explicit = colorProp?.t === "str" ? colorProp.v : undefined;
    return { id: pv.v, color: resolveTagColor(pv.v, explicit) };
  }
  return null;
}

export function isGraphPerspectiveNode(node: WireNode): boolean {
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  return types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.graphPerspectiveTag);
}

export function listPerspectiveNodes(wireNodes: WireNode[]): WireNode[] {
  return wireNodes
    .filter(isGraphPerspectiveNode)
    .toSorted((a, b) => a.text.localeCompare(b.text) || a.id.localeCompare(b.id));
}

function boolProp(node: WireNode, fieldId: string): boolean | null {
  const v = (node.props[fieldId] ?? []).find((p) => p.t === "bool" && typeof p.v === "boolean");
  return v ? v.v : null;
}

// oxlint-disable-next-line complexity -- GAP [[01M1MGCEBYDFRNJX1JKXXN825H]]
export function parsePerspective(node: WireNode): LensPerspective {
  const kindsRaw = (node.props[SYSTEM_IDS.lensEdgeKindsField] ?? []).map((value) =>
    value.t === "ref" ? graphSourceKey(value.v) : String(value.v),
  );
  const edgeKinds = kindsRaw.filter(
    (k): k is EdgeKind => EDGE_KIND_SET.has(k) || k.startsWith("prop:"),
  );
  const source = (field: string, fallback: string) => {
    const value = node.props[field]?.[0];
    return value?.t === "ref" ? graphSourceKey(value.v) : (strProp(node, field) ?? fallback);
  };
  const rendererValue = node.props[SYSTEM_IDS.lensRendererField]?.[0];
  const renderer =
    rendererValue?.t === "ref"
      ? graphRendererKey(rendererValue.v)
      : (strProp(node, SYSTEM_IDS.lensRendererField) ?? DEFAULT_RENDERER);
  const maxNodes = numProp(node, SYSTEM_IDS.lensMaxNodesField);
  const layoutRaw = strProp(node, SYSTEM_IDS.lensLayoutField);
  const layout: LensLayout =
    layoutRaw === "radial" ||
    layoutRaw === "hierarchical" ||
    layoutRaw === "grid" ||
    layoutRaw === "force"
      ? layoutRaw
      : DEFAULT_LAYOUT;
  const densityRaw = strProp(node, SYSTEM_IDS.lensLabelDensityField);
  const labelDensity: LensLabelDensity =
    densityRaw === "low" || densityRaw === "medium" || densityRaw === "high"
      ? densityRaw
      : DEFAULT_LABEL_DENSITY;
  const spread = numProp(node, SYSTEM_IDS.lensSpreadField);
  const linkDistance = numProp(node, SYSTEM_IDS.lensLinkDistanceField);
  const showLabels = boolProp(node, SYSTEM_IDS.lensShowLabelsField);
  const curvedLinks = boolProp(node, SYSTEM_IDS.lensCurvedLinksField);
  const autorotate = boolProp(node, SYSTEM_IDS.lensAutorotateField);
  return {
    id: node.id,
    label: node.text.trim() || "Untitled",
    query: strProp(node, SYSTEM_IDS.lensQueryField) ?? "",
    renderer,
    colorBy: source(SYSTEM_IDS.lensColorByField, DEFAULT_COLOR_BY),
    labelBy: source(SYSTEM_IDS.lensLabelByField, "text"),
    sizeBy: source(SYSTEM_IDS.lensSizeByField, DEFAULT_SIZE_BY),
    edgeKinds: node.props[SYSTEM_IDS.lensEdgeKindsField] ? edgeKinds : [...DEFAULT_EDGE_KINDS],
    maxNodes:
      maxNodes !== null && Number.isFinite(maxNodes) && maxNodes > 0
        ? Math.floor(maxNodes)
        : DEFAULT_MAX_NODES,
    clusterBy: source(SYSTEM_IDS.lensClusterByField, DEFAULT_CLUSTER_BY),
    focus: refProp(node, SYSTEM_IDS.lensFocusField),
    layout,
    spread: spread !== null && Number.isFinite(spread) && spread > 0 ? spread : DEFAULT_SPREAD,
    linkDistance:
      linkDistance !== null && Number.isFinite(linkDistance) && linkDistance > 0
        ? linkDistance
        : DEFAULT_LINK_DISTANCE,
    showLabels: showLabels ?? DEFAULT_SHOW_LABELS,
    curvedLinks: curvedLinks ?? DEFAULT_CURVED_LINKS,
    autorotate: autorotate ?? DEFAULT_AUTOROTATE,
    labelDensity,
  };
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
   * read from its own carrier and they stay disjoint: text tokens here, the
   * children array below, ref prop values after that. `:node/mentions` is
   * deliberately NOT used — it is carrier-independent (see ds/datoms), so
   * querying it would double every ref-prop edge as a mention as well.
   */
  if (kinds.has("mention")) {
    for (const n of wireNodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const to of new Set(extractMentions(n.text))) {
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
): string {
  if (colorBy.startsWith("fixed:")) {
    const hex = colorBy.slice("fixed:".length).trim() || "#888888";
    return hex;
  }
  if (colorBy.startsWith("prop:") || colorBy === "parent" || colorBy === "none") {
    return hashTagColor(resolveCluster(wire, byId, parentOf, colorBy).key);
  }
  // default: tag — untagged uses the same djb2 palette (tag-color pipeline).
  const tag = firstTagOf(wire, byId);
  if (tag) return tag.color;
  return hashTagColor("untagged");
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
  const nodes: LensNode[] = [];
  for (const id of keep) {
    const wire = byId.get(id);
    if (!wire) continue;
    const color = resolveColor(wire, byId, perspective.colorBy, parentOf);
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

/** New definitions use node references; legacy source strings remain readable. */
export function sourceValue(key: string): PropValue {
  const id = graphSourceId(key);
  return id !== null ? { t: "ref", v: id } : { t: "str", v: key };
}

export function perspectiveProps(p: LensPerspective): WireNode["props"] {
  const rendererId = graphRendererId(p.renderer);
  return {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.graphPerspectiveTag }],
    [SYSTEM_IDS.lensRendererField]: [
      rendererId ? { t: "ref", v: rendererId } : { t: "str", v: p.renderer },
    ],
    [SYSTEM_IDS.lensQueryField]: [{ t: "str", v: p.query }],
    [SYSTEM_IDS.lensColorByField]: [sourceValue(p.colorBy)],
    [SYSTEM_IDS.lensSizeByField]: [sourceValue(p.sizeBy)],
    [SYSTEM_IDS.lensClusterByField]: [sourceValue(p.clusterBy)],
    [SYSTEM_IDS.lensLabelByField]: [sourceValue(p.labelBy ?? "text")],
    [SYSTEM_IDS.lensEdgeKindsField]: (p.edgeKinds.length ? p.edgeKinds : ["none"]).map(sourceValue),
    ...(p.focus !== null
      ? { [SYSTEM_IDS.lensFocusField]: [{ t: "ref" as const, v: p.focus }] }
      : {}),
    [SYSTEM_IDS.lensMaxNodesField]: [{ t: "num", v: p.maxNodes }],
    [SYSTEM_IDS.lensLayoutField]: [{ t: "str", v: p.layout }],
    [SYSTEM_IDS.lensSpreadField]: [{ t: "num", v: p.spread }],
    [SYSTEM_IDS.lensLinkDistanceField]: [{ t: "num", v: p.linkDistance }],
    [SYSTEM_IDS.lensShowLabelsField]: [{ t: "bool", v: p.showLabels }],
    [SYSTEM_IDS.lensCurvedLinksField]: [{ t: "bool", v: p.curvedLinks }],
    [SYSTEM_IDS.lensAutorotateField]: [{ t: "bool", v: p.autorotate }],
    [SYSTEM_IDS.lensLabelDensityField]: [{ t: "str", v: p.labelDensity }],
  };
}
