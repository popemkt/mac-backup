import type { SchemaIndex } from "./schema";
import type { WireNode } from "@kb/contracts";
import { compareRootOrder, hasQueryDef, typeRefsOf } from "@kb/model";
import { tagColorOf, tagPalette, type TagPalette } from "./tag-color";
import {
  resolveVisibleProps,
  isIntrinsicSystemPropKey,
  type ResolvePropsOptions,
} from "./field-visibility";
import { hasText, textOr } from "./text";
import {
  EXPANDED_STORAGE_KEY,
  SYSTEM_IDS,
  WORKSPACE_ROOT_ID,
  isSysPrefixed,
  type NodeMap,
  type OutlineNode,
  type ResolvedProp,
  type TagBadge,
} from "./types";

function isTagNode(node: WireNode | OutlineNode | undefined): boolean {
  return typeRefsOf(node).includes(SYSTEM_IDS.tag);
}

function isFieldNode(node: WireNode | OutlineNode | undefined): boolean {
  return typeRefsOf(node).includes(SYSTEM_IDS.field);
}

/**
 * DISPLAY: the `#tag` chips a row shows.
 *
 * Derived from the kind slot (`typeRefsOf` — the truth reader) minus the kind
 * refs themselves: `sys.f.type → sys.tag` means "this node IS a supertag", so
 * rendering it as a `#tag` chip on the tag's own page would be nonsense, and
 * `sys.field` likewise. That subtraction is the whole reason this list is not
 * the graph: read it back as membership and every supertag looks untagged. Any
 * decision about what a node *is* must call `typeRefsOf` directly.
 */
function resolveTags(wire: WireNode, byId: Map<string, WireNode>, palette: TagPalette): TagBadge[] {
  const tags: TagBadge[] = [];
  for (const typeId of typeRefsOf(wire)) {
    if (typeId === SYSTEM_IDS.tag || typeId === SYSTEM_IDS.field) continue;
    const target = byId.get(typeId);
    if (!isTagNode(target)) continue;
    tags.push({
      id: typeId,
      name: textOr(target?.text, typeId),
      color: tagColorOf(typeId, palette),
    });
  }
  return tags;
}

/** Nodes that appear in some parent's children list. */
function childIdSet(nodes: WireNode[]): Set<string> {
  const kids = new Set<string>();
  for (const n of nodes) {
    for (const c of n.children) kids.add(c);
  }
  return kids;
}

/** Top-level outline roots: non-system nodes not nested under another node. */
export function forestRootIds(nodes: WireNode[]): string[] {
  const kids = childIdSet(nodes);
  return nodes
    .filter((n) => {
      if (kids.has(n.id)) return false;
      if (isSysPrefixed(n.id)) return false;
      return !(isFieldNode(n) || isTagNode(n));
    })
    .toSorted(compareRootOrder)
    .map((n) => n.id);
}

function wireHasVisibleFields(wire: WireNode, byId: Map<string, WireNode>): boolean {
  for (const [fieldId, values] of Object.entries(wire.props)) {
    if (values.length === 0) continue;
    if (fieldId === SYSTEM_IDS.typeField) continue;
    if (isIntrinsicSystemPropKey(fieldId)) continue;
    const fieldNode = byId.get(fieldId);
    const hidden = fieldNode?.props[SYSTEM_IDS.hiddenField]?.[0];
    if (hidden?.t === "bool" && hidden.v) continue;
    return true;
  }
  return false;
}

function nodeDefaultsCollapsed(wire: WireNode, byId: Map<string, WireNode>): boolean {
  if (hasQueryDef(wire.props)) return true;
  if (wire.children.length > 0) return true;
  if (wireHasVisibleFields(wire, byId)) return true;
  return false;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameTags(a: readonly TagBadge[], b: readonly TagBadge[]): boolean {
  return (
    a.length === b.length &&
    a.every((tag, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        tag.id === other.id &&
        tag.name === other.name &&
        tag.color === other.color
      );
    })
  );
}

function sameProps(a: OutlineNode["props"], b: OutlineNode["props"]): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key] ?? [];
    const right = b[key];
    return (
      right !== undefined &&
      left.length === right.length &&
      left.every((value, i) => {
        const other = right[i];
        return (
          value === other || (other !== undefined && value.t === other.t && value.v === other.v)
        );
      })
    );
  });
}

/** Whether two projections of a node are the same value, field by field. */
function sameOutlineNode(a: OutlineNode, b: OutlineNode): boolean {
  return a.collapsed === b.collapsed && sameMeaning(a, b);
}

/**
 * Whether two projections of a node say the same about it, whatever their
 * expansion: everything but `collapsed`, which is the outline's view state
 * and nothing a schema reader asks (`lib/schema.ts`).
 */
export function sameMeaning(a: OutlineNode, b: OutlineNode): boolean {
  return (
    a === b ||
    (a.text === b.text &&
      a.parentId === b.parentId &&
      a.createdAt === b.createdAt &&
      a.updatedAt === b.updatedAt &&
      sameIds(a.children, b.children) &&
      sameTags(a.tags, b.tags) &&
      sameProps(a.props, b.props))
  );
}

const NO_PREVIOUS: ReadonlyMap<string, OutlineNode> = new Map();

/**
 * The outline view model for `nodes`. Each node's tag chips — names and
 * colours — and its default collapse (does it show fields?) are resolved against
 * `graph`: the whole graph, which is `nodes` itself unless `nodes` is a
 * projection of it (an ontology scope). The outline's structure comes from
 * `nodes`; what the schema means, and the tag palette (`tagPalette`, one
 * palette for the whole workspace), never depend on which content is shown
 * (`lib/schema.ts`).
 *
 * The projection is persistent: a node that projects to the value it had in
 * `previous` keeps that object, so a node's identity changes exactly when what
 * it shows does. That is what lets a reader depend on the nodes it read
 * instead of on the whole map (`stores/graph-read.ts`).
 */
export function wireToOutlineMap(
  nodes: WireNode[],
  expandedIds: Set<string>,
  graph: readonly WireNode[] = nodes,
  previous: ReadonlyMap<string, OutlineNode> = NO_PREVIOUS,
): NodeMap {
  const byId = new Map(graph.map((n) => [n.id, n]));
  const palette = tagPalette(graph);
  const parentOf = new Map<string, string>();
  for (const n of nodes) {
    for (const c of n.children) parentOf.set(c, n.id);
  }

  const map: NodeMap = new Map();
  const keep = (next: OutlineNode): void => {
    const before = previous.get(next.id);
    map.set(next.id, before !== undefined && sameOutlineNode(before, next) ? before : next);
  };
  const roots = forestRootIds(nodes);
  const rootSet = new Set(roots);

  keep({
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
    // A forest root is in no children list: the workspace is its parent.
    const parentId = parentOf.get(wire.id) ?? (rootSet.has(wire.id) ? WORKSPACE_ROOT_ID : null);
    const tags = resolveTags(wire, byId, palette);
    const collapsed = nodeDefaultsCollapsed(wire, byId) && !expandedIds.has(wire.id);
    keep({
      id: wire.id,
      text: wire.text,
      parentId,
      children: [...wire.children],
      collapsed,
      props: wire.props,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt,
      tags,
    });
  }

  return map;
}

export function resolveProps(
  node: OutlineNode,
  schema: SchemaIndex,
  opts?: ResolvePropsOptions,
): ResolvedProp[] {
  return resolveVisibleProps(node, schema, opts);
}

/** Resolve a ref prop to a label: target text when present, otherwise raw id fallback. */
function resolveRefLabel(refId: string, schema: SchemaIndex): string | null {
  const n = schema.get(refId);
  if (!n) return null;
  return n.text || refId;
}

export function formatPropValue(
  value: OutlineNode["props"][string][number],
  schema: SchemaIndex,
): string {
  switch (value.t) {
    case "ref": {
      const resolved = resolveRefLabel(value.v, schema);
      return resolved ?? value.v;
    }
    case "bool":
      return value.v ? "true" : "false";
    case "num":
      return String(value.v);
    case "date":
    case "str":
      return value.v;
    default:
      return JSON.stringify(value);
  }
}
/**
 * Persisted set of node ids in localStorage — the one storage shape for
 * "which nodes has the user flagged for this?" (expanded rows, per-node debug
 * fields). Callers own the key; this owns the encoding and the failure modes.
 */
export function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!hasText(raw)) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveIdSet(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore quota / private mode
  }
}

/** Load expanded ids from the one key outline expansion state reads. */
export function loadExpandedIds(): Set<string> {
  return loadIdSet(EXPANDED_STORAGE_KEY);
}

export function saveExpandedIds(ids: Set<string>): void {
  saveIdSet(EXPANDED_STORAGE_KEY, ids);
}
