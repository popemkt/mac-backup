/**
 * V0 graph-lens module — pure extract of {nodes, edges} from client DataScript
 * + wire nodes, driven by a #graph-perspective node's lens props.
 */
import type { WireNode } from "@kb/contracts";
import type { QueryDb } from "@/ds/db";
import { extractMentions } from "@/ds/datoms";
import { runQuery } from "@/ds/query";
import { hashTagColor, resolveTagColor } from "@/lib/tag-color";
import { SYSTEM_IDS, isSysPrefixed } from "@/lib/types";
import { logWarn } from "@/lib/log";

export type EdgeKind = "mention" | "child" | "ref-prop";

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
  tags: string[];
  degree: number;
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

export const LENS_RENDERERS = ["force2d", "tree", "cluster", "force3d"] as const;

const EDGE_KIND_SET = new Set<string>(["mention", "child", "ref-prop"]);

function strProp(node: WireNode, fieldId: string): string | null {
  const v = (node.props[fieldId] ?? []).find((p) => p.t === "str" && typeof p.v === "string");
  return v ? v.v.trim() : null;
}

function numProp(node: WireNode, fieldId: string): number | null {
  const v = (node.props[fieldId] ?? []).find((p) => p.t === "num" && typeof p.v === "number");
  return v ? v.v : null;
}

function multiStrProp(node: WireNode, fieldId: string): string[] {
  return (node.props[fieldId] ?? [])
    .filter((p) => p.t === "str" && typeof p.v === "string")
    .map((p) => p.v.trim())
    .filter(Boolean);
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
  const kindsRaw = multiStrProp(node, SYSTEM_IDS.lensEdgeKindsField);
  const edgeKinds = kindsRaw.filter((k): k is EdgeKind => EDGE_KIND_SET.has(k));
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
    label: node.text || node.id,
    query: strProp(node, SYSTEM_IDS.lensQueryField) ?? "",
    renderer: strProp(node, SYSTEM_IDS.lensRendererField) ?? DEFAULT_RENDERER,
    colorBy: strProp(node, SYSTEM_IDS.lensColorByField) ?? DEFAULT_COLOR_BY,
    sizeBy: strProp(node, SYSTEM_IDS.lensSizeByField) ?? DEFAULT_SIZE_BY,
    edgeKinds: edgeKinds.length > 0 ? edgeKinds : [...DEFAULT_EDGE_KINDS],
    maxNodes:
      maxNodes !== null && Number.isFinite(maxNodes) && maxNodes > 0
        ? Math.floor(maxNodes)
        : DEFAULT_MAX_NODES,
    clusterBy: strProp(node, SYSTEM_IDS.lensClusterByField) ?? DEFAULT_CLUSTER_BY,
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
export function resolveClusterKey(
  wire: WireNode,
  byId: Map<string, WireNode>,
  parentOf: Map<string, string>,
  clusterBy: string,
): string {
  void byId;
  const mode = (clusterBy || DEFAULT_CLUSTER_BY).trim();
  if (mode === "none" || mode === "") return "none";
  if (mode === "parent") return parentOf.get(wire.id) ?? "root";
  if (mode.startsWith("tag:")) {
    const tagId = mode.slice("tag:".length).trim();
    if (!tagId) return "untagged";
    const types = wire.props[SYSTEM_IDS.typeField] ?? [];
    const has = types.some((v) => v.t === "ref" && v.v === tagId);
    return has ? tagId : "untagged";
  }
  if (mode.startsWith("prop:")) {
    const fieldId = mode.slice("prop:".length).trim();
    if (!fieldId) return "none";
    const vals = wire.props[fieldId] ?? [];
    const ref = vals.find((v) => v.t === "ref");
    if (ref) return ref.v;
    const other = vals[0];
    if (other && other.t !== "ref") return String(other.v);
    return "none";
  }
  return "none";
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
  wireNodes: WireNode[],
  lensNodes: LensNode[],
  focusId: string | null,
): LensTreeNode[] {
  const byLens = new Map(lensNodes.map((n) => [n.id, n]));
  const nodeSet = new Set(byLens.keys());
  const byWire = new Map(wireNodes.map((n) => [n.id, n]));

  const childMap = new Map<string, string[]>();
  for (const id of nodeSet) {
    const wire = byWire.get(id);
    if (!wire) continue;
    const kids = wire.children.filter((c) => nodeSet.has(c));
    childMap.set(id, kids);
  }

  const visiting = new Set<string>();
  const built = new Map<string, LensTreeNode>();

  function build(id: string): LensTreeNode | null {
    if (built.has(id)) return built.get(id)!;
    if (visiting.has(id)) return null; // cycle
    visiting.add(id);
    const meta = byLens.get(id);
    if (!meta) {
      visiting.delete(id);
      return null;
    }
    const kids: LensTreeNode[] = [];
    for (const childId of childMap.get(id) ?? []) {
      const child = build(childId);
      if (child) kids.push(child);
    }
    visiting.delete(id);
    const node: LensTreeNode = {
      id,
      label: meta.label,
      color: meta.color,
      size: meta.size,
      children: kids,
    };
    built.set(id, node);
    return node;
  }

  if (focusId !== null && nodeSet.has(focusId)) {
    const root = build(focusId);
    return root ? [root] : [];
  }

  const parentOf = buildParentMap(wireNodes, nodeSet);
  const roots = [...nodeSet]
    .filter((id) => !parentOf.has(id))
    .toSorted((a, b) => a.localeCompare(b));
  const forest: LensTreeNode[] = [];
  for (const id of roots) {
    const t = build(id);
    if (t) forest.push(t);
  }
  return forest;
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
  db: QueryDb,
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

  if (kinds.has("ref-prop")) {
    for (const n of wireNodes) {
      if (!nodeSet.has(n.id)) continue;
      for (const values of Object.values(n.props)) {
        for (const pv of values) {
          if (pv.t === "ref") push(n.id, pv.v, "ref-prop");
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

export function resolveColor(wire: WireNode, byId: Map<string, WireNode>, colorBy: string): string {
  if (colorBy.startsWith("fixed:")) {
    const hex = colorBy.slice("fixed:".length).trim() || "#888888";
    return hex;
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

export function extractLensGraph(
  db: QueryDb,
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
    const color = resolveColor(wire, byId, perspective.colorBy);
    const clusterKey = resolveClusterKey(wire, byId, parentOf, perspective.clusterBy);
    const size = resolveSize(perspective.sizeBy, finalDegrees.get(id) ?? 0, wire.children.length);
    const wireTags: string[] = [];
    const types = wire.props[SYSTEM_IDS.typeField] ?? [];
    for (const pv of types) {
      if (pv.t === "ref") {
        const target = byId.get(pv.v);
        if (target && isTagNode(target)) wireTags.push(target.text || pv.v);
      }
    }
    nodes.push({
      id,
      label: wire.text,
      color,
      size,
      clusterKey,
      tags: wireTags,
      degree: finalDegrees.get(id) ?? 0,
    });
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, edges, dropped, queryError };
}
