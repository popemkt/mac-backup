import type { WireNode } from "@kb/protocol";
import { isQueryTagBadges } from "@/lib/query-node";
import { resolveTagColor } from "@/lib/tag-color";
import { compareWireNodeId } from "@/lib/tx";
import {
  resolveVisibleProps,
  isIntrinsicSystemPropKey,
  type ResolvePropsOptions,
} from "@/lib/field-visibility";
import {
  EXPANDED_STORAGE_KEY,
  LEGACY_COLLAPSED_STORAGE_KEY,
  LEGACY_EXPANDED_QUERIES_STORAGE_KEY,
  SYSTEM_IDS,
  WORKSPACE_ROOT_ID,
  type NodeMap,
  type OutlineNode,
  type ResolvedProp,
  type TagBadge,
} from "@/lib/types";

function isTagNode(node: WireNode | OutlineNode | undefined): boolean {
  if (!node) return false;
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  return types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.tag);
}

function isFieldNode(node: WireNode | OutlineNode | undefined): boolean {
  if (!node) return false;
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  return types.some((v) => v.t === "ref" && v.v === SYSTEM_IDS.field);
}

function resolveTags(
  wire: WireNode,
  byId: Map<string, WireNode>,
): TagBadge[] {
  const types = wire.props[SYSTEM_IDS.typeField] ?? [];
  const tags: TagBadge[] = [];
  for (const pv of types) {
    if (pv.t !== "ref") continue;
    if (pv.v === SYSTEM_IDS.tag || pv.v === SYSTEM_IDS.field) continue;
    const target = byId.get(pv.v);
    if (!isTagNode(target)) continue;
    const colorProp = target?.props[SYSTEM_IDS.colorField]?.[0];
    const explicitColor =
      colorProp?.t === "str" ? String(colorProp.v) : undefined;
    tags.push({
      id: pv.v,
      name: target?.text || pv.v,
      color: resolveTagColor(pv.v, explicitColor),
    });
  }
  return tags;
}

/** Nodes that appear in some parent's children list. */
export function childIdSet(nodes: WireNode[]): Set<string> {
  const kids = new Set<string>();
  for (const n of nodes) {
    for (const c of n.children) kids.add(c);
  }
  return kids;
}

/** Top-level outline roots: non-system nodes not nested under another node. */
export function forestRootIds(nodes: WireNode[]): string[] {
  const kids = childIdSet(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes
    .filter((n) => {
      if (kids.has(n.id)) return false;
      if (n.id.startsWith("sys.")) return false;
      if (isFieldNode(n) || isTagNode(n)) return false;
      // Keep orphaned content nodes even if they somehow look like fields
      void byId;
      return true;
    })
    .sort(compareWireNodeId)
    .map((n) => n.id);
}

function wireHasVisibleFields(
  wire: WireNode,
  byId: Map<string, WireNode>,
): boolean {
  for (const [fieldId, values] of Object.entries(wire.props)) {
    if (values.length === 0) continue;
    if (fieldId === SYSTEM_IDS.typeField) continue;
    if (isIntrinsicSystemPropKey(fieldId)) continue;
    const fieldNode = byId.get(fieldId);
    const hidden = fieldNode?.props[SYSTEM_IDS.hiddenField]?.[0];
    if (hidden?.t === "bool" && hidden.v === true) continue;
    return true;
  }
  return false;
}

function nodeDefaultsCollapsed(
  wire: WireNode,
  tags: TagBadge[],
  byId: Map<string, WireNode>,
): boolean {
  if (isQueryTagBadges(tags)) return true;
  if (wire.children.length > 0) return true;
  if (wireHasVisibleFields(wire, byId)) return true;
  return false;
}

export function wireToOutlineMap(
  nodes: WireNode[],
  expandedIds: Set<string>,
): NodeMap {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string>();
  for (const n of nodes) {
    for (const c of n.children) parentOf.set(c, n.id);
  }

  const map: NodeMap = new Map();
  const roots = forestRootIds(nodes);

  map.set(WORKSPACE_ROOT_ID, {
    id: WORKSPACE_ROOT_ID,
    text: "kb",
    parentId: null,
    children: roots,
    collapsed: false,
    props: {},
    createdAt: "",
    updatedAt: "",
    tags: [],
  });

  for (const wire of nodes) {
    const parentId = parentOf.get(wire.id) ?? null;
    const outlineParent =
      parentId ?? (roots.includes(wire.id) ? WORKSPACE_ROOT_ID : null);
    const tags = resolveTags(wire, byId);
    const collapsed =
      nodeDefaultsCollapsed(wire, tags, byId) && !expandedIds.has(wire.id);
    map.set(wire.id, {
      id: wire.id,
      text: wire.text,
      parentId: outlineParent,
      children: [...wire.children],
      collapsed,
      props: wire.props,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt,
      tags,
    });
  }

  // Fix parent pointers for forest roots
  for (const rootId of roots) {
    const n = map.get(rootId);
    if (n) map.set(rootId, { ...n, parentId: WORKSPACE_ROOT_ID });
  }

  return map;
}

export function resolveProps(
  node: OutlineNode,
  nodes: NodeMap,
  opts?: ResolvePropsOptions,
): ResolvedProp[] {
  return resolveVisibleProps(node, nodes, opts);
}

export function formatPropValue(
  value: OutlineNode["props"][string][number],
  nodes: NodeMap,
): string {
  switch (value.t) {
    case "ref":
      return nodes.get(value.v)?.text ?? value.v;
    case "bool":
      return value.v ? "true" : "false";
    case "num":
      return String(value.v);
    case "date":
    case "str":
      return String(value.v);
    default:
      return JSON.stringify(value);
  }
}

function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore quota / private mode
  }
}

/** Load expanded ids, migrating legacy collapsed / query-expanded keys once. */
export function loadExpandedIds(): Set<string> {
  const expanded = loadIdSet(EXPANDED_STORAGE_KEY);
  if (expanded.size > 0) return expanded;

  const migrated = new Set<string>();
  try {
    const legacyCollapsed = loadIdSet(LEGACY_COLLAPSED_STORAGE_KEY);
    const legacyQueries = loadIdSet(LEGACY_EXPANDED_QUERIES_STORAGE_KEY);
    for (const id of legacyQueries) migrated.add(id);
    // Intentional breakage: kb-ui:collapsed stored *collapsed* ids; inverting
    // to expanded requires node metadata we don't have at load time — drop it.
    // Only legacy query-expanded ids are worth preserving on first migration.
    if (migrated.size > 0) saveExpandedIds(migrated);
    void legacyCollapsed;
  } catch {
    // ignore
  }
  return migrated;
}

export function saveExpandedIds(ids: Set<string>): void {
  saveIdSet(EXPANDED_STORAGE_KEY, ids);
}

export function searchNodes(
  nodes: NodeMap,
  query: string,
): Array<{ id: string; text: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Array<{ id: string; text: string }> = [];
  for (const n of nodes.values()) {
    if (n.id === WORKSPACE_ROOT_ID) continue;
    if (n.text.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
      hits.push({ id: n.id, text: n.text });
    }
  }
  return hits.slice(0, 50);
}
