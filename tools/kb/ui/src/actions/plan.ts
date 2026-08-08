/**
 * Pure outline mutation planners — map UI intents to local tx + registry actions.
 */
import type { WireNode } from "@kb/protocol";
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
}

function requireNode(nodes: WireNode[], id: string): WireNode {
  const n = wireById(nodes).get(id);
  if (!n) throw new Error(`node not found: ${id}`);
  return n;
}

export function planUpdateText(
  nodes: WireNode[],
  id: string,
  text: string,
): PlannedMutation {
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
): PlannedMutation {
  const node = cloneWire(requireNode(nodes, id));
  const left = node.text.slice(0, cursor);
  const right = node.text.slice(cursor);
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

  const parent = findParentWire(nodes, id);
  const upserts: WireNode[] = [node, child];
  let position: number | undefined;
  let parentId: string | undefined;

  if (parent) {
    const p = cloneWire(parent);
    const idx = p.children.indexOf(id);
    position = idx + 1;
    parentId = p.id;
    p.children = [
      ...p.children.slice(0, position),
      newId,
      ...p.children.slice(position),
    ];
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

/** Merge `id` into previous sibling (same parent); append text + adopt children. */
export function planMergeWithPrevious(
  nodes: WireNode[],
  id: string,
): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  if (!parent) return null;
  const idx = parent.children.indexOf(id);
  if (idx <= 0) return null;
  const prevId = parent.children[idx - 1]!;
  const prev = cloneWire(requireNode(nodes, prevId));
  const cur = requireNode(nodes, id);
  const joinAt = prev.text.length;
  const baseChildCount = prev.children.length;
  prev.text = prev.text + cur.text;
  prev.children = [...prev.children, ...cur.children];
  prev.updatedAt = nowIso();

  const p = cloneWire(parent);
  p.children = p.children.filter((c) => c !== id);
  p.updatedAt = nowIso();

  return {
    upserts: [prev, p],
    deletes: [id],
    actions: [
      {
        id: "node.update",
        input: { id: prevId, text: prev.text },
      },
      ...cur.children.map((cid, i) => ({
        id: "node.update",
        input: {
          id: cid,
          parent: prevId,
          position: baseChildCount + i,
        },
      })),
      { id: "node.update", input: { id, delete: true } },
    ],
    focusId: prevId,
    focusCursor: joinAt,
  };
}

export function planIndent(
  nodes: WireNode[],
  id: string,
): PlannedMutation | null {
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

export function planOutdent(
  nodes: WireNode[],
  id: string,
): PlannedMutation | null {
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
    g.children = [
      ...g.children.slice(0, position),
      id,
      ...g.children.slice(position),
    ];
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
    list = list.filter(
      (pv) => JSON.stringify(pv) !== JSON.stringify(oldValue),
    );
  }
  list.push(value);
  node.props[fieldId] = list;
  node.updatedAt = nowIso();

  const unsetProps =
    oldValue !== undefined
      ? [{ field: fieldId, value: oldValue }]
      : undefined;

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

export function planAddTag(
  nodes: WireNode[],
  nodeId: string,
  tagId: string,
): PlannedMutation {
  return planSetProp(nodes, nodeId, SYSTEM_IDS.typeField, {
    t: "ref",
    v: tagId,
  });
}

export function planRemoveTag(
  nodes: WireNode[],
  nodeId: string,
  tagId: string,
): PlannedMutation {
  return planUnsetProp(nodes, nodeId, SYSTEM_IDS.typeField, {
    t: "ref",
    v: tagId,
  });
}

export function planDefineField(
  name: string,
  newId: string,
): PlannedMutation {
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

export function planDefineTag(
  name: string,
  newId: string,
): PlannedMutation {
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

export function planCreateAfter(
  nodes: WireNode[],
  afterId: string,
  newId: string,
): PlannedMutation {
  const after = requireNode(nodes, afterId);
  return planSplit(nodes, afterId, after.text.length, newId);
}

/** Add a forest-root content node (no parent). */
export function planAddRootNode(
  text: string,
  newId: string,
): PlannedMutation {
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
