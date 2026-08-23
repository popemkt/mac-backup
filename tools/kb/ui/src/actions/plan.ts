/**
 * Pure outline mutation planners — map UI intents to local tx + registry actions.
 */
import type { WireNode } from "@kb/protocol";
import { wouldCreateExtendsCycle } from "@kb/ontology";
import { DEFAULT_QUERY_EDN } from "@/lib/query-node";
import type { PropValue } from "@/lib/types";
import { SYSTEM_IDS } from "@/lib/types";
import { forestRootIds } from "@/lib/graph-view";
import { cloneWire, findParentWire, nowIso, wireById } from "@/lib/tx";

export interface PlannedMutation {
  upserts: WireNode[];
  deletes: string[];
  /** Registry invocations to POST (order matters). */
  actions: Array<{ id: string; input: unknown }>;
  /** New node focus after apply (split/create). */
  focusId?: string;
  focusCursor?: number;
  /** Nodes whose collapsed state must be cleared after apply (D05). */
  revealIds?: string[];
}
export interface PlanSplitOpts {
  /** Ids currently expanded in the UI outline map — required, no default (F2). */
  expandedIds: Set<string>;
}
function requireNode(nodes: WireNode[], id: string): WireNode {
  const n = wireById(nodes).get(id);
  if (!n) throw new Error(`node not found: ${id}`);
  return n;
}
export function planUpdateText(nodes: WireNode[], id: string, text: string): PlannedMutation {
  const node = cloneWire(requireNode(nodes, id));
  node.text = text;
  node.updatedAt = nowIso();
  return {
    upserts: [node],
    deletes: [],
    actions: [{ id: "node.update", input: { id, text } }],
  };
}
export function planSplit(
  nodes: WireNode[],
  id: string,
  cursor: number,
  newId: string,
  opts: PlanSplitOpts,
): PlannedMutation {
  const node = cloneWire(requireNode(nodes, id));
  const left = node.text.slice(0, cursor);
  const right = node.text.slice(cursor);
  const asFirstChild = node.children.length > 0 && opts.expandedIds.has(id);
  node.text = left;
  node.updatedAt = nowIso();

  const at = nowIso();
  const child: WireNode = {
    id: newId,
    text: right,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };

  if (asFirstChild) {
    node.children = [newId, ...node.children];
    return {
      upserts: [node, child],
      deletes: [],
      actions: [
        { id: "node.update", input: { id, text: left } },
        {
          id: "node.add",
          input: { id: newId, text: right, parent: id, position: 0 },
        },
      ],
      focusId: newId,
      focusCursor: 0,
    };
  }

  const parent = findParentWire(nodes, id);
  const upserts: WireNode[] = [node, child];
  let position: number | undefined;
  let parentId: string | undefined;

  if (parent) {
    const p = cloneWire(parent);
    const idx = p.children.indexOf(id);
    position = idx + 1;
    parentId = p.id;
    p.children = [...p.children.slice(0, position), newId, ...p.children.slice(position)];
    p.updatedAt = at;
    upserts.push(p);
  }

  const actions: PlannedMutation["actions"] = [
    { id: "node.update", input: { id, text: left } },
    {
      id: "node.add",
      input: {
        id: newId,
        text: right,
        ...(parentId ? { parent: parentId, position } : {}),
      },
    },
  ];

  return {
    upserts,
    deletes: [],
    actions,
    focusId: newId,
    focusCursor: 0,
  };
}

export function planDelete(nodes: WireNode[], id: string): PlannedMutation {
  const parent = findParentWire(nodes, id);
  const upserts: WireNode[] = [];
  if (parent) {
    const p = cloneWire(parent);
    p.children = p.children.filter((c) => c !== id);
    p.updatedAt = nowIso();
    upserts.push(p);
  }
  return {
    upserts,
    deletes: [id],
    actions: [{ id: "node.update", input: { id, delete: true } }],
  };
}

/**
 * Merge `id` into an explicit visual predecessor (r1 D09): append text,
 * adopt children, remove `id` from its own parent. Works across parents —
 * the target may be a deeper last-descendant of the array-level sibling.
 */
export function planMergeInto(
  nodes: WireNode[],
  id: string,
  targetId: string,
): PlannedMutation | null {
  if (id === targetId) return null;
  const cur = requireNode(nodes, id);
  const target = cloneWire(requireNode(nodes, targetId));

  const joinAt = target.text.length;
  const baseChildCount = target.children.length;
  target.text = target.text + cur.text;
  target.children = [...target.children, ...cur.children];
  target.updatedAt = nowIso();

  const parent = findParentWire(nodes, id);
  const upserts: WireNode[] = [target];
  if (parent && parent.id !== targetId) {
    const p = cloneWire(parent);
    p.children = p.children.filter((c) => c !== id);
    p.updatedAt = nowIso();
    upserts.push(p);
  }

  return {
    upserts,
    deletes: [id],
    actions: [
      { id: "node.update", input: { id: targetId, text: target.text } },
      ...cur.children.map((cid, i) => ({
        id: "node.update" as const,
        input: {
          id: cid,
          parent: targetId,
          position: baseChildCount + i,
        },
      })),
      { id: "node.update", input: { id, delete: true } },
    ],
    focusId: targetId,
    focusCursor: joinAt,
  };
}

/**
 * Merge `id` into its previous ARRAY sibling (same parent).
 * Prefer planMergeInto with a visually-resolved target when the caller has
 * instance context (r1 D09). Returns null for first children / roots —
 * callers must handle those via delete-empty or outdent (r1 D08).
 */
export function planMergeWithPrevious(nodes: WireNode[], id: string): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  if (!parent) return null;
  const idx = parent.children.indexOf(id);
  if (idx <= 0) return null;
  return planMergeInto(nodes, id, parent.children[idx - 1]!);
}

export function planIndent(nodes: WireNode[], id: string): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  const oldParent: WireNode | null = parent;
  let sibs: string[];
  if (parent) {
    sibs = parent.children;
  } else {
    // Forest roots: same id-sorted order as forestRootIds / outline display.
    sibs = forestRootIds(nodes);
  }

  const idx = sibs.indexOf(id);
  if (idx <= 0) return null;
  const prevId = sibs[idx - 1]!;
  const prev = cloneWire(requireNode(nodes, prevId));
  const position = prev.children.length;
  prev.children = [...prev.children, id];
  prev.updatedAt = nowIso();

  const upserts: WireNode[] = [prev];
  if (oldParent) {
    const p = cloneWire(oldParent);
    p.children = p.children.filter((c) => c !== id);
    p.updatedAt = nowIso();
    upserts.push(p);
  }

  return {
    upserts,
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: { id, parent: prevId, position },
      },
    ],
  };
}

export function planOutdent(nodes: WireNode[], id: string): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  if (!parent) return null;
  const grand = findParentWire(nodes, parent.id);
  const at = nowIso();
  const upserts: WireNode[] = [];

  const p = cloneWire(parent);
  p.children = p.children.filter((c) => c !== id);
  p.updatedAt = at;
  upserts.push(p);

  if (grand) {
    const g = cloneWire(grand);
    const pIdx = g.children.indexOf(parent.id);
    const position = pIdx + 1;
    g.children = [...g.children.slice(0, position), id, ...g.children.slice(position)];
    g.updatedAt = at;
    upserts.push(g);
    return {
      upserts,
      deletes: [],
      actions: [
        {
          id: "node.update",
          input: { id, parent: grand.id, position },
        },
      ],
    };
  }

  // Become forest root
  return {
    upserts,
    deletes: [],
    actions: [{ id: "node.update", input: { id, parent: null } }],
  };
}

export function planMove(
  nodes: WireNode[],
  id: string,
  dir: "up" | "down",
): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  if (!parent) return null;
  const idx = parent.children.indexOf(id);
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= parent.children.length) return null;

  const p = cloneWire(parent);
  const kids = [...p.children];
  kids.splice(idx, 1);
  kids.splice(target, 0, id);
  p.children = kids;
  p.updatedAt = nowIso();

  return {
    upserts: [p],
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: { id, position: target },
      },
    ],
  };
}

/** A pure inverse transaction: applying it undoes the source tx locally. */
export interface InverseTx {
  upserts: WireNode[];
  deletes: string[];
}

/**
 * Compute the inverse of a planned mutation against its PRE state (r1 D19).
 * - Nodes deleted by the plan are restored verbatim.
 * - Nodes minted by the plan are removed.
 * - Touched survivors revert to their pre-plan payload.
 * Pure: no store access, fully unit-testable.
 */
export function invertPlan(preWire: WireNode[], plan: PlannedMutation): InverseTx {
  const preById = wireById(preWire);
  const upserts: WireNode[] = [];
  const deletes: string[] = [];

  // Restore hard-deleted subtrees (plan deletes cascade via children ids).
  for (const id of plan.deletes) {
    const pre = preById.get(id);
    if (pre && !upserts.some((u) => u.id === id)) {
      upserts.push(cloneWire(pre));
    }
  }

  // Revert every upserted node; drop ones the plan minted.
  for (const u of plan.upserts) {
    const pre = preById.get(u.id);
    if (!pre) {
      if (!deletes.includes(u.id)) deletes.push(u.id);
      continue;
    }
    if (!upserts.some((x) => x.id === u.id)) {
      upserts.push(cloneWire(pre));
    }
  }

  return { upserts, deletes };
}

/**
 * Best-effort compensating registry actions so remote state follows a local
 * undo. Hard-deleted ids are re-added (`node.add`); surviving touched nodes
 * revert text/structure (`node.update`). Order: removals first.
 */
export function inversePlanActions(
  preWire: WireNode[],
  plan: PlannedMutation,
  inv: InverseTx,
): PlannedMutation["actions"] {
  const actions: PlannedMutation["actions"] = [];
  for (const id of inv.deletes) {
    actions.push({ id: "node.update", input: { id, delete: true } });
  }
  const preById = wireById(preWire);
  const wasDeleted = new Set(plan.deletes);
  for (const u of inv.upserts) {
    const pre = preById.get(u.id);
    if (!pre) continue;
    const parent = findParentWire(
      preWire.filter((n) => n.id !== u.id),
      u.id,
    );
    if (wasDeleted.has(u.id)) {
      actions.push({
        id: "node.add",
        input: {
          id: u.id,
          text: u.text,
          ...(parent ? { parent: parent.id } : {}),
        },
      });
    } else {
      actions.push({
        id: "node.update",
        input: {
          id: u.id,
          text: u.text,
          ...(parent ? { parent: parent.id } : { parent: null }),
        },
      });
    }
  }
  return actions;
}

export function planSetProp(
  nodes: WireNode[],
  nodeId: string,
  fieldId: string,
  value: PropValue,
  oldValue?: PropValue,
): PlannedMutation {
  const node = cloneWire(requireNode(nodes, nodeId));
  let list = [...(node.props[fieldId] ?? [])];
  if (oldValue !== undefined) {
    list = list.filter((pv) => JSON.stringify(pv) !== JSON.stringify(oldValue));
  }
  list.push(value);
  node.props[fieldId] = list;
  node.updatedAt = nowIso();

  const unsetProps = oldValue !== undefined ? [{ field: fieldId, value: oldValue }] : undefined;

  return {
    upserts: [node],
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: {
          id: nodeId,
          ...(unsetProps ? { unsetProps } : {}),
          setProps: [{ field: fieldId, value }],
        },
      },
    ],
  };
}

export function planUnsetProp(
  nodes: WireNode[],
  nodeId: string,
  fieldId: string,
  value?: PropValue,
): PlannedMutation {
  const node = cloneWire(requireNode(nodes, nodeId));
  if (value === undefined) {
    delete node.props[fieldId];
  } else {
    const list = (node.props[fieldId] ?? []).filter(
      (pv) => JSON.stringify(pv) !== JSON.stringify(value),
    );
    if (list.length === 0) delete node.props[fieldId];
    else node.props[fieldId] = list;
  }
  node.updatedAt = nowIso();
  return {
    upserts: [node],
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: {
          id: nodeId,
          unsetProps: [{ field: fieldId, ...(value ? { value } : {}) }],
        },
      },
    ],
  };
}

export function planAddTag(nodes: WireNode[], nodeId: string, tagId: string): PlannedMutation {
  return planSetProp(nodes, nodeId, SYSTEM_IDS.typeField, {
    t: "ref",
    v: tagId,
  });
}

export function planRemoveTag(nodes: WireNode[], nodeId: string, tagId: string): PlannedMutation {
  return planUnsetProp(nodes, nodeId, SYSTEM_IDS.typeField, {
    t: "ref",
    v: tagId,
  });
}

export function planDefineField(name: string, newId: string): PlannedMutation {
  const at = nowIso();
  const node: WireNode = {
    id: newId,
    text: name,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  return {
    upserts: [node],
    deletes: [],
    actions: [{ id: "field.define", input: { name, id: newId } }],
  };
}

export function planDefineTag(name: string, newId: string): PlannedMutation {
  const at = nowIso();
  const node: WireNode = {
    id: newId,
    text: name,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  return {
    upserts: [node],
    deletes: [],
    actions: [{ id: "tag.define", input: { name, id: newId } }],
  };
}

/** W4: mint a root query node — #query tag + sys.f.query EDN prop. */
export function planNewQueryNode(
  text: string,
  newId: string,
  edn: string = DEFAULT_QUERY_EDN,
): PlannedMutation {
  const at = nowIso();
  const node: WireNode = {
    id: newId,
    text,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.queryTag }],
      [SYSTEM_IDS.queryField]: [{ t: "str", v: edn }],
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  return {
    upserts: [node],
    deletes: [],
    actions: [
      {
        id: "node.add",
        input: {
          text,
          id: newId,
          tags: [SYSTEM_IDS.queryTag],
          props: [
            {
              field: SYSTEM_IDS.queryField,
              value: { t: "str", v: edn },
            },
          ],
        },
      },
    ],
    focusId: newId,
    focusCursor: text.length,
  };
}

// ── ontology planners (r5 core) ────────────────────────────────────────────
// All are thin wrappers over planSetProp / planUnsetProp, exactly as
// planAddTag / planRemoveTag are, so they inherit the optimistic-tx, undo,
// and receipt plumbing untouched.

/** Mint an ontology: a plain node tagged #ontology. */
export function planDefineOntology(name: string, newId: string): PlannedMutation {
  const at = nowIso();
  const node: WireNode = {
    id: newId,
    text: name,
    props: {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.ontologyTag }],
    },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  return {
    upserts: [node],
    deletes: [],
    actions: [
      {
        id: "node.add",
        input: {
          text: name,
          id: newId,
          tags: [SYSTEM_IDS.ontologyTag],
        },
      },
    ],
    focusId: newId,
    focusCursor: name.length,
  };
}

export function planOntologyAddInclude(
  nodes: WireNode[],
  ontoId: string,
  tagId: string,
): PlannedMutation {
  return planSetProp(nodes, ontoId, SYSTEM_IDS.ontoIncludeField, {
    t: "ref",
    v: tagId,
  });
}

export function planOntologyRemoveInclude(
  nodes: WireNode[],
  ontoId: string,
  tagId: string,
): PlannedMutation {
  return planUnsetProp(nodes, ontoId, SYSTEM_IDS.ontoIncludeField, {
    t: "ref",
    v: tagId,
  });
}

/** "Pin": promote a derived member to explicit so it survives the tag going. */
export function planOntologyAddMember(
  nodes: WireNode[],
  ontoId: string,
  nodeId: string,
): PlannedMutation {
  return planSetProp(nodes, ontoId, SYSTEM_IDS.ontoMemberField, {
    t: "ref",
    v: nodeId,
  });
}

export function planOntologyRemoveMember(
  nodes: WireNode[],
  ontoId: string,
  nodeId: string,
): PlannedMutation {
  return planUnsetProp(nodes, ontoId, SYSTEM_IDS.ontoMemberField, {
    t: "ref",
    v: nodeId,
  });
}

/**
 * Veto a node. Also drops a matching pin in the SAME plan, so pin and veto can
 * never contradict each other on one ontology.
 */
export function planOntologyExclude(
  nodes: WireNode[],
  ontoId: string,
  nodeId: string,
): PlannedMutation {
  const exclude = planSetProp(nodes, ontoId, SYSTEM_IDS.ontoExcludeField, {
    t: "ref",
    v: nodeId,
  });
  const pinned = (
    wireById(nodes).get(ontoId)?.props[SYSTEM_IDS.ontoMemberField] ?? []
  ).some((pv) => pv.t === "ref" && pv.v === nodeId);
  if (!pinned) return exclude;
  const unpin = planOntologyRemoveMember(exclude.upserts, ontoId, nodeId);
  return {
    upserts: unpin.upserts,
    deletes: [],
    actions: [...exclude.actions, ...unpin.actions],
  };
}

export function planOntologyUnexclude(
  nodes: WireNode[],
  ontoId: string,
  nodeId: string,
): PlannedMutation {
  return planUnsetProp(nodes, ontoId, SYSTEM_IDS.ontoExcludeField, {
    t: "ref",
    v: nodeId,
  });
}

/**
 * `A extends B` = A inherits B's members (A is the superset).
 * Returns null when the edge would close a cycle — a cheap client-side
 * pre-check; the resolver stays cycle-safe regardless.
 */
export function planOntologyAddExtends(
  nodes: WireNode[],
  ontoId: string,
  parentId: string,
): PlannedMutation | null {
  if (wouldCreateExtendsCycle(nodes, ontoId, parentId)) return null;
  return planSetProp(nodes, ontoId, SYSTEM_IDS.ontoExtendsField, {
    t: "ref",
    v: parentId,
  });
}

export function planOntologyRemoveExtends(
  nodes: WireNode[],
  ontoId: string,
  parentId: string,
): PlannedMutation {
  return planUnsetProp(nodes, ontoId, SYSTEM_IDS.ontoExtendsField, {
    t: "ref",
    v: parentId,
  });
}

/** Single-valued str: replace the previous value rather than appending. */
export function planOntologySetQuery(
  nodes: WireNode[],
  ontoId: string,
  edn: string,
): PlannedMutation {
  const existing = wireById(nodes).get(ontoId)?.props[
    SYSTEM_IDS.ontoQueryField
  ]?.[0];
  const trimmed = edn.trim();
  if (!trimmed) {
    return planUnsetProp(nodes, ontoId, SYSTEM_IDS.ontoQueryField);
  }
  return planSetProp(
    nodes,
    ontoId,
    SYSTEM_IDS.ontoQueryField,
    { t: "str", v: trimmed },
    existing,
  );
}

export function planOntologySetClosure(
  nodes: WireNode[],
  ontoId: string,
  mode: "none" | "descendants",
): PlannedMutation {
  const existing = wireById(nodes).get(ontoId)?.props[
    SYSTEM_IDS.ontoClosureField
  ]?.[0];
  if (mode === "none") {
    return existing
      ? planUnsetProp(nodes, ontoId, SYSTEM_IDS.ontoClosureField, existing)
      : planUnsetProp(nodes, ontoId, SYSTEM_IDS.ontoClosureField);
  }
  return planSetProp(
    nodes,
    ontoId,
    SYSTEM_IDS.ontoClosureField,
    { t: "str", v: mode },
    existing,
  );
}

/** Insert a sibling after/before `anchorId` under its parent (never as child). F2. */
export function planInsertSibling(
  nodes: WireNode[],
  anchorId: string,
  side: "before" | "after",
  newId: string,
  text = "",
): PlannedMutation {
  const at = nowIso();
  const child: WireNode = {
    id: newId,
    text,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  const parent = findParentWire(nodes, anchorId);
  // Forest root: no parent to hold order yet (pre-F7 migration) — mint as root.
  // Phase 2 will give this a stored order key; until then at least never bury as first child.
  if (!parent) {
    return {
      upserts: [child],
      deletes: [],
      actions: [{ id: "node.add", input: { text, id: newId } }],
      focusId: newId,
      focusCursor: text.length,
    };
  }
  const p = cloneWire(parent);
  const idx = p.children.indexOf(anchorId);
  if (idx === -1) throw new Error(`anchor not in parent: ${anchorId}`);
  const position = side === "after" ? idx + 1 : idx;
  p.children = [...p.children.slice(0, position), newId, ...p.children.slice(position)];
  p.updatedAt = at;
  return {
    upserts: [p, child],
    deletes: [],
    actions: [{ id: "node.add", input: { id: newId, text, parent: parent.id, position } }],
    focusId: newId,
    focusCursor: text.length,
  };
}

/** Insert a child under `parentId` at index (or start/end). */
export function planInsertChild(
  nodes: WireNode[],
  parentId: string,
  index: number | "start" | "end",
  newId: string,
  text = "",
): PlannedMutation {
  const parent = cloneWire(requireNode(nodes, parentId));
  const at = nowIso();
  const child: WireNode = {
    id: newId,
    text,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  const position =
    index === "start" ? 0 : index === "end" ? parent.children.length : index;
  parent.children = [
    ...parent.children.slice(0, position),
    newId,
    ...parent.children.slice(position),
  ];
  parent.updatedAt = at;
  return {
    upserts: [parent, child],
    deletes: [],
    actions: [{ id: "node.add", input: { id: newId, text, parent: parentId, position } }],
    focusId: newId,
    focusCursor: text.length,
  };
}
/** Add a forest-root content node (no parent). */
export function planAddRootNode(text: string, newId: string): PlannedMutation {
  const at = nowIso();
  const node: WireNode = {
    id: newId,
    text,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  return {
    upserts: [node],
    deletes: [],
    actions: [{ id: "node.add", input: { text, id: newId } }],
    focusId: newId,
    focusCursor: text.length,
  };
}

/** Append a child under `parentId` (first or additional). */
export function planAddChild(
  nodes: WireNode[],
  parentId: string,
  newId: string,
  text = "",
): PlannedMutation {
  const parent = cloneWire(requireNode(nodes, parentId));
  const at = nowIso();
  const position = parent.children.length;
  const child: WireNode = {
    id: newId,
    text,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  parent.children = [...parent.children, newId];
  parent.updatedAt = at;
  return {
    upserts: [parent, child],
    deletes: [],
    actions: [
      {
        id: "node.add",
        input: { id: newId, text, parent: parentId, position },
      },
    ],
    focusId: newId,
    focusCursor: text.length,
  };
}

/** Insert a child at the TOP of `parentId`'s children ('O' above first kid). */
export function planPrependChild(
  nodes: WireNode[],
  parentId: string,
  newId: string,
  text = "",
): PlannedMutation {
  const parent = cloneWire(requireNode(nodes, parentId));
  const at = nowIso();
  const child: WireNode = {
    id: newId,
    text,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
  parent.children = [newId, ...parent.children];
  parent.updatedAt = at;
  return {
    upserts: [parent, child],
    deletes: [],
    actions: [
      {
        id: "node.add",
        input: { id: newId, text, parent: parentId, position: 0 },
      },
    ],
    focusId: newId,
    focusCursor: text.length,
  };
}

export function planAddTagField(
  nodes: WireNode[],
  tagId: string,
  fieldId: string,
): PlannedMutation {
  if (tagId.startsWith("sys.")) {
    throw new Error("sys.* tags are read-only");
  }
  return planSetProp(nodes, tagId, SYSTEM_IDS.fieldsField, {
    t: "ref",
    v: fieldId,
  });
}

export function planRemoveTagField(
  nodes: WireNode[],
  tagId: string,
  fieldId: string,
): PlannedMutation {
  if (tagId.startsWith("sys.")) {
    throw new Error("sys.* tags are read-only");
  }
  return planUnsetProp(nodes, tagId, SYSTEM_IDS.fieldsField, {
    t: "ref",
    v: fieldId,
  });
}

export function planSetFieldHidden(
  nodes: WireNode[],
  fieldId: string,
  hidden: boolean,
): PlannedMutation {
  if (fieldId.startsWith("sys.")) {
    throw new Error("sys.* fields are read-only");
  }
  if (hidden) {
    return planSetProp(nodes, fieldId, SYSTEM_IDS.hiddenField, {
      t: "bool",
      v: true,
    });
  }
  return planUnsetProp(nodes, fieldId, SYSTEM_IDS.hiddenField, {
    t: "bool",
    v: true,
  });
}

export function planSetTagColor(
  nodes: WireNode[],
  tagId: string,
  color: string | null,
): PlannedMutation {
  if (tagId.startsWith("sys.")) {
    throw new Error("sys.* tags are read-only");
  }
  const trimmed = color?.trim();
  if (!trimmed) {
    const node = requireNode(nodes, tagId);
    const existing = node.props[SYSTEM_IDS.colorField]?.[0];
    return planUnsetProp(
      nodes,
      tagId,
      SYSTEM_IDS.colorField,
      existing?.t === "str" ? existing : undefined,
    );
  }
  return planSetProp(nodes, tagId, SYSTEM_IDS.colorField, {
    t: "str",
    v: trimmed,
  });
}

/** Replace sys.f.fieldType on a field definition node. */
export function planSetFieldType(
  nodes: WireNode[],
  fieldId: string,
  fieldType: string,
): PlannedMutation {
  if (fieldId.startsWith("sys.")) {
    throw new Error("sys.* fields are read-only");
  }
  const node = requireNode(nodes, fieldId);
  const existing = node.props[SYSTEM_IDS.fieldTypeField]?.[0];
  return planSetProp(
    nodes,
    fieldId,
    SYSTEM_IDS.fieldTypeField,
    { t: "str", v: fieldType },
    existing,
  );
}

/** Append a target-tag constraint (union). */
export function planAddFieldTargetTag(
  nodes: WireNode[],
  fieldId: string,
  tagId: string,
): PlannedMutation {
  if (fieldId.startsWith("sys.")) {
    throw new Error("sys.* fields are read-only");
  }
  return planSetProp(nodes, fieldId, SYSTEM_IDS.targetTagField, {
    t: "ref",
    v: tagId,
  });
}

export function planRemoveFieldTargetTag(
  nodes: WireNode[],
  fieldId: string,
  tagId: string,
): PlannedMutation {
  if (fieldId.startsWith("sys.")) {
    throw new Error("sys.* fields are read-only");
  }
  return planUnsetProp(nodes, fieldId, SYSTEM_IDS.targetTagField, {
    t: "ref",
    v: tagId,
  });
}

/** Replace sys.f.targetQuery EDN (empty clears). */
export function planSetFieldTargetQuery(
  nodes: WireNode[],
  fieldId: string,
  edn: string | null,
): PlannedMutation {
  if (fieldId.startsWith("sys.")) {
    throw new Error("sys.* fields are read-only");
  }
  const node = requireNode(nodes, fieldId);
  const existing = node.props[SYSTEM_IDS.targetQueryField]?.[0];
  const trimmed = edn?.trim() ?? "";
  if (!trimmed) {
    return planUnsetProp(
      nodes,
      fieldId,
      SYSTEM_IDS.targetQueryField,
      existing?.t === "str" ? existing : undefined,
    );
  }
  return planSetProp(
    nodes,
    fieldId,
    SYSTEM_IDS.targetQueryField,
    { t: "str", v: trimmed },
    existing,
  );
}

export function planSetViewMode(
  nodes: WireNode[],
  frameId: string,
  mode: "list" | "table" | "board" | "cards",
): PlannedMutation {
  const frame = cloneWire(requireNode(nodes, frameId));
  const existing = frame.props[SYSTEM_IDS.viewModeField]?.[0];
  return planSetProp(nodes, frameId, SYSTEM_IDS.viewModeField, { t: "str", v: mode }, existing);
}

/** Persist graph perspective renderer (force2d|tree|cluster|force3d). */
export function planSetLensRenderer(
  nodes: WireNode[],
  perspectiveId: string,
  renderer: string,
): PlannedMutation {
  const node = cloneWire(requireNode(nodes, perspectiveId));
  const existing = node.props[SYSTEM_IDS.lensRendererField]?.[0];
  return planSetProp(
    nodes,
    perspectiveId,
    SYSTEM_IDS.lensRendererField,
    { t: "str", v: renderer },
    existing,
  );
}

export function planSetViewSort(
  nodes: WireNode[],
  frameId: string,
  sortSpecs: Array<{ fieldId: string; dir: "asc" | "desc" }>,
): PlannedMutation {
  const frame = cloneWire(requireNode(nodes, frameId));
  const sortRefs: PropValue[] = sortSpecs.map((s) => ({
    t: "ref",
    v: s.fieldId,
  }));
  const sortDirs: PropValue[] = sortSpecs.map((s) => ({
    t: "str",
    v: s.dir,
  }));

  frame.props[SYSTEM_IDS.viewSortField] = sortRefs;
  frame.props[SYSTEM_IDS.viewSortDirField] = sortDirs;
  frame.updatedAt = nowIso();

  return {
    upserts: [frame],
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: {
          id: frameId,
          unsetProps: [{ field: SYSTEM_IDS.viewSortField }, { field: SYSTEM_IDS.viewSortDirField }],
          setProps: [
            ...sortRefs.map((r) => ({
              field: SYSTEM_IDS.viewSortField,
              value: r,
            })),
            ...sortDirs.map((d) => ({
              field: SYSTEM_IDS.viewSortDirField,
              value: d,
            })),
          ],
        },
      },
    ],
  };
}

export function planSetViewDisplay(
  nodes: WireNode[],
  frameId: string,
  displayFieldIds: string[],
): PlannedMutation {
  const frame = cloneWire(requireNode(nodes, frameId));
  const refs: PropValue[] = displayFieldIds.map((id) => ({
    t: "ref",
    v: id,
  }));

  frame.props[SYSTEM_IDS.viewDisplayField] = refs;
  frame.updatedAt = nowIso();

  return {
    upserts: [frame],
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: {
          id: frameId,
          unsetProps: [{ field: SYSTEM_IDS.viewDisplayField }],
          setProps: refs.map((r) => ({
            field: SYSTEM_IDS.viewDisplayField,
            value: r,
          })),
        },
      },
    ],
  };
}

export function planSetViewColwidth(
  nodes: WireNode[],
  frameId: string,
  colwidth: Record<string, number>,
): PlannedMutation {
  const frame = cloneWire(requireNode(nodes, frameId));
  const existing = frame.props[SYSTEM_IDS.viewColwidthField]?.[0];
  const json = JSON.stringify(colwidth);
  return planSetProp(nodes, frameId, SYSTEM_IDS.viewColwidthField, { t: "str", v: json }, existing);
}

export function planSetViewPagesize(
  nodes: WireNode[],
  frameId: string,
  pagesize: number,
): PlannedMutation {
  const frame = cloneWire(requireNode(nodes, frameId));
  const existing = frame.props[SYSTEM_IDS.viewPagesizeField]?.[0];
  return planSetProp(
    nodes,
    frameId,
    SYSTEM_IDS.viewPagesizeField,
    { t: "num", v: pagesize },
    existing,
  );
}

export function planSetViewGroup(
  nodes: WireNode[],
  frameId: string,
  fieldId: string | null,
): PlannedMutation {
  const frame = requireNode(nodes, frameId);
  const existing = frame.props[SYSTEM_IDS.viewGroupField]?.[0];
  if (!fieldId) {
    return planUnsetProp(
      nodes,
      frameId,
      SYSTEM_IDS.viewGroupField,
      existing?.t === "ref" ? existing : undefined,
    );
  }
  return planSetProp(nodes, frameId, SYSTEM_IDS.viewGroupField, { t: "ref", v: fieldId }, existing);
}

/** Replace all view.filter str props with the given EDN list. */
export function planSetViewFilters(
  nodes: WireNode[],
  frameId: string,
  filterEdnList: string[],
): PlannedMutation {
  const frame = cloneWire(requireNode(nodes, frameId));
  const vals: PropValue[] = filterEdnList.map((edn) => ({
    t: "str",
    v: edn,
  }));
  frame.props[SYSTEM_IDS.viewFilterField] = vals;
  frame.updatedAt = nowIso();
  return {
    upserts: [frame],
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: {
          id: frameId,
          unsetProps: [{ field: SYSTEM_IDS.viewFilterField }],
          setProps: vals.map((v) => ({
            field: SYSTEM_IDS.viewFilterField,
            value: v,
          })),
        },
      },
    ],
  };
}

/**
 * Board drag: unset ALL group values, then set at most one.
 * Does NOT touch children[] / tree order. No multi-value pretence.
 */
export function planMoveBoardCard(
  nodes: WireNode[],
  nodeId: string,
  fieldId: string,
  _oldValue: PropValue | null,
  newValue: PropValue | null,
): PlannedMutation {
  const node = cloneWire(requireNode(nodes, nodeId));
  const existing = [...(node.props[fieldId] ?? [])];
  if (newValue) node.props[fieldId] = [newValue];
  else delete node.props[fieldId];
  node.updatedAt = nowIso();

  const unsetProps =
    existing.length > 0 ? existing.map((value) => ({ field: fieldId, value })) : undefined;
  const setProps = newValue ? [{ field: fieldId, value: newValue }] : undefined;

  return {
    upserts: [node],
    deletes: [],
    actions: [
      {
        id: "node.update",
        input: {
          id: nodeId,
          ...(unsetProps ? { unsetProps } : {}),
          ...(setProps ? { setProps } : {}),
        },
      },
    ],
  };
}
