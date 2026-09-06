import type { ActionInvocation, WireNode } from "@kb/contracts";
import { fieldTypeValue, rankBetween, wouldCreateExtendsCycle, type FieldType } from "@kb/model";
import { forestRootIds } from "@/lib/graph-view";
import { DEFAULT_QUERY_EDN } from "@/lib/query-node";
import { findParentWire, wireById } from "@/lib/tx";
import { SYSTEM_IDS, isSysPrefixed, type PropValue } from "@/lib/types";

export interface PlannedMutation {
  actions: ActionInvocation[];
  focusId?: string;
  focusCursor?: number;
}

const plan = (...actions: ActionInvocation[]): PlannedMutation => ({ actions });
function requireNode(nodes: WireNode[], id: string): WireNode {
  const node = wireById(nodes).get(id);
  if (!node) throw new Error(`node not found: ${id}`);
  return node;
}
const update = (id: string, input: Record<string, unknown>): PlannedMutation =>
  plan({ id: "node.update", input: { id, ...input } });

function replaceProps(
  nodes: WireNode[],
  id: string,
  replacements: Array<{ field: string; values: PropValue[] }>,
): PlannedMutation {
  const current = requireNode(nodes, id);
  const unsetProps = replacements
    .filter(({ field }) => (current.props[field] ?? []).length > 0)
    .map(({ field }) => ({ field }));
  const setProps = replacements.flatMap(({ field, values }) =>
    values.map((value) => ({ field, value })),
  );
  return plan(
    ...(unsetProps.length > 0 ? [{ id: "node.update", input: { id, unsetProps } }] : []),
    ...(setProps.length > 0 ? [{ id: "node.update", input: { id, setProps } }] : []),
  );
}

const replaceProp = (nodes: WireNode[], id: string, field: string, values: PropValue[]) =>
  replaceProps(nodes, id, [{ field, values }]);

export const planUpdateText = (_nodes: WireNode[], id: string, text: string) =>
  update(id, { text });
export function planSplit(
  nodes: WireNode[],
  id: string,
  cursor: number,
  newId: string,
  opts: { expandedIds: Set<string> },
): PlannedMutation {
  const node = requireNode(nodes, id);
  const left = node.text.slice(0, cursor);
  const right = node.text.slice(cursor);
  const firstChild = node.children.length > 0 && opts.expandedIds.has(id);
  const parent = firstChild ? node : findParentWire(nodes, id);
  const position = firstChild ? 0 : parent ? parent.children.indexOf(id) + 1 : undefined;
  return {
    actions: [
      { id: "node.update", input: { id, text: left } },
      {
        id: "node.add",
        input: { id: newId, text: right, ...(parent ? { parent: parent.id, position } : {}) },
      },
    ],
    focusId: newId,
    focusCursor: 0,
  };
}
export const planDelete = (_nodes: WireNode[], id: string) =>
  update(id, { delete: true, descendants: "cascade" });
export function planMergeInto(
  nodes: WireNode[],
  id: string,
  targetId: string,
): PlannedMutation | null {
  if (id === targetId) return null;
  const source = requireNode(nodes, id);
  const target = requireNode(nodes, targetId);
  return {
    actions: [
      { id: "node.update", input: { id: targetId, text: target.text + source.text } },
      ...source.children.map((childId, offset) => ({
        id: "node.update",
        input: { id: childId, parent: targetId, position: target.children.length + offset },
      })),
      { id: "node.update", input: { id, delete: true } },
    ],
    focusId: targetId,
    focusCursor: target.text.length,
  };
}
export function planMergeWithPrevious(nodes: WireNode[], id: string): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  if (!parent) return null;
  const index = parent.children.indexOf(id);
  const previous = index > 0 ? parent.children[index - 1] : undefined;
  return previous === undefined ? null : planMergeInto(nodes, id, previous);
}
export function planIndent(nodes: WireNode[], id: string): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  const siblings = parent?.children ?? forestRootIds(nodes);
  const index = siblings.indexOf(id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  return previous === undefined
    ? null
    : update(id, { parent: previous, position: requireNode(nodes, previous).children.length });
}
export function planOutdent(nodes: WireNode[], id: string): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  if (!parent) return null;
  const grand = findParentWire(nodes, parent.id);
  return update(
    id,
    grand
      ? { parent: grand.id, position: grand.children.indexOf(parent.id) + 1 }
      : { parent: null },
  );
}
export function planMove(
  nodes: WireNode[],
  id: string,
  direction: "up" | "down",
): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  const siblings = parent?.children ?? forestRootIds(nodes);
  const index = siblings.indexOf(id);
  const position = direction === "up" ? index - 1 : index + 1;
  if (position < 0 || position >= siblings.length) return null;
  if (parent) return update(id, { position });
  const reordered = siblings.toSpliced(index, 1).toSpliced(position, 0, id);
  const byId = wireById(nodes);
  return update(id, {
    order: rankBetween(
      byId.get(reordered[position - 1] ?? "")?.order,
      byId.get(reordered[position + 1] ?? "")?.order,
    ),
  });
}

export function planSetProp(
  _nodes: WireNode[],
  id: string,
  field: string,
  value: PropValue,
  oldValue?: PropValue,
): PlannedMutation {
  return plan(
    ...(oldValue === undefined
      ? []
      : [{ id: "node.update", input: { id, unsetProps: [{ field, value: oldValue }] } }]),
    { id: "node.update", input: { id, setProps: [{ field, value }] } },
  );
}
export function planUnsetProp(
  _nodes: WireNode[],
  id: string,
  field: string,
  value?: PropValue,
): PlannedMutation {
  return update(id, { unsetProps: [{ field, ...(value === undefined ? {} : { value }) }] });
}
export const planAddTag = (n: WireNode[], id: string, tag: string) =>
  planSetProp(n, id, SYSTEM_IDS.typeField, { t: "ref", v: tag });
export const planRemoveTag = (n: WireNode[], id: string, tag: string) =>
  planUnsetProp(n, id, SYSTEM_IDS.typeField, { t: "ref", v: tag });
export const planDefineField = (name: string, id: string) =>
  plan({ id: "field.define", input: { name, id } });
export const planDefineTag = (name: string, id: string) =>
  plan({ id: "tag.define", input: { name, id } });
export function planNewQueryNode(
  text: string,
  id: string,
  edn = DEFAULT_QUERY_EDN,
): PlannedMutation {
  return {
    actions: [
      {
        id: "node.add",
        input: {
          id,
          text,
          props: [{ field: SYSTEM_IDS.queryField, value: { t: "str", v: edn } }],
        },
      },
    ],
    focusId: id,
    focusCursor: text.length,
  };
}
export function planDefineOntology(name: string, id: string): PlannedMutation {
  return {
    actions: [{ id: "node.add", input: { id, text: name, tags: [SYSTEM_IDS.ontologyTag] } }],
    focusId: id,
    focusCursor: name.length,
  };
}

const refProp = (n: WireNode[], id: string, field: string, value: string) =>
  planSetProp(n, id, field, { t: "ref", v: value });
const unrefProp = (n: WireNode[], id: string, field: string, value: string) =>
  planUnsetProp(n, id, field, { t: "ref", v: value });
export const planOntologyAddInclude = (n: WireNode[], id: string, v: string) =>
  refProp(n, id, SYSTEM_IDS.ontoIncludeField, v);
export const planOntologyRemoveInclude = (n: WireNode[], id: string, v: string) =>
  unrefProp(n, id, SYSTEM_IDS.ontoIncludeField, v);
export const planOntologyAddMember = (n: WireNode[], id: string, v: string) =>
  refProp(n, id, SYSTEM_IDS.ontoMemberField, v);
export const planOntologyRemoveMember = (n: WireNode[], id: string, v: string) =>
  unrefProp(n, id, SYSTEM_IDS.ontoMemberField, v);
export const planOntologyUnexclude = (n: WireNode[], id: string, v: string) =>
  unrefProp(n, id, SYSTEM_IDS.ontoExcludeField, v);
export const planOntologyRemoveExtends = (n: WireNode[], id: string, v: string) =>
  unrefProp(n, id, SYSTEM_IDS.ontoExtendsField, v);
export function planOntologyExclude(nodes: WireNode[], id: string, value: string): PlannedMutation {
  const actions = refProp(nodes, id, SYSTEM_IDS.ontoExcludeField, value).actions;
  const pinned = (requireNode(nodes, id).props[SYSTEM_IDS.ontoMemberField] ?? []).some(
    (p) => p.t === "ref" && p.v === value,
  );
  return pinned
    ? { actions: [...actions, ...unrefProp(nodes, id, SYSTEM_IDS.ontoMemberField, value).actions] }
    : { actions };
}
export function planOntologyAddExtends(
  nodes: WireNode[],
  id: string,
  parent: string,
): PlannedMutation | null {
  return wouldCreateExtendsCycle(nodes, id, parent)
    ? null
    : refProp(nodes, id, SYSTEM_IDS.ontoExtendsField, parent);
}
export function planOntologySetQuery(nodes: WireNode[], id: string, edn: string): PlannedMutation {
  const value = edn.trim();
  const old = requireNode(nodes, id).props[SYSTEM_IDS.ontoQueryField]?.[0];
  return value
    ? planSetProp(nodes, id, SYSTEM_IDS.ontoQueryField, { t: "str", v: value }, old)
    : planUnsetProp(nodes, id, SYSTEM_IDS.ontoQueryField);
}
export function planOntologySetClosure(
  nodes: WireNode[],
  id: string,
  mode: "none" | "descendants",
): PlannedMutation {
  const old = requireNode(nodes, id).props[SYSTEM_IDS.ontoClosureField]?.[0];
  return mode === "none"
    ? planUnsetProp(nodes, id, SYSTEM_IDS.ontoClosureField, old)
    : planSetProp(nodes, id, SYSTEM_IDS.ontoClosureField, { t: "str", v: mode }, old);
}

function addNode(
  id: string,
  text: string,
  parent?: string,
  position?: number,
  order?: string,
): PlannedMutation {
  return {
    actions: [
      {
        id: "node.add",
        input: {
          id,
          text,
          ...(parent !== undefined ? { parent, position } : {}),
          ...(order !== undefined ? { order } : {}),
        },
      },
    ],
    focusId: id,
    focusCursor: text.length,
  };
}
export function planInsertSibling(
  nodes: WireNode[],
  anchorId: string,
  side: "before" | "after",
  id: string,
  text = "",
): PlannedMutation {
  const parent = findParentWire(nodes, anchorId);
  const siblings = parent?.children ?? forestRootIds(nodes);
  const anchor = siblings.indexOf(anchorId);
  if (anchor < 0) throw new Error(`anchor not found: ${anchorId}`);
  const position = side === "after" ? anchor + 1 : anchor;
  const byId = wireById(nodes);
  const order = rankBetween(
    byId.get(siblings[position - 1] ?? "")?.order,
    byId.get(siblings[position] ?? "")?.order,
  );
  return addNode(id, text, parent?.id, position, order);
}
export const planInsertChild = (
  n: WireNode[],
  parent: string,
  index: number | "start" | "end",
  id: string,
  text = "",
) =>
  addNode(
    id,
    text,
    parent,
    index === "start" ? 0 : index === "end" ? requireNode(n, parent).children.length : index,
  );
export const planAddRootNode = (text: string, id: string) => addNode(id, text);
export const planAddChild = (n: WireNode[], parent: string, id: string, text = "") =>
  addNode(id, text, parent, requireNode(n, parent).children.length);
export const planPrependChild = (_n: WireNode[], parent: string, id: string, text = "") =>
  addNode(id, text, parent, 0);

function mutableSchema(id: string): void {
  if (isSysPrefixed(id)) throw new Error("sys.* schema nodes are read-only");
}
function schemaMutation(id: string, build: () => PlannedMutation): PlannedMutation {
  mutableSchema(id);
  return build();
}
export const planAddTagField = (n: WireNode[], id: string, field: string) =>
  schemaMutation(id, () => refProp(n, id, SYSTEM_IDS.fieldsField, field));
export const planRemoveTagField = (n: WireNode[], id: string, field: string) =>
  schemaMutation(id, () => unrefProp(n, id, SYSTEM_IDS.fieldsField, field));
export function planSetFieldHidden(n: WireNode[], id: string, hidden: boolean) {
  mutableSchema(id);
  return hidden
    ? planSetProp(n, id, SYSTEM_IDS.hiddenField, { t: "bool", v: true })
    : planUnsetProp(n, id, SYSTEM_IDS.hiddenField, { t: "bool", v: true });
}
export function planSetTagColor(n: WireNode[], id: string, color: string | null) {
  mutableSchema(id);
  const value = color?.trim() ?? "";
  const old = requireNode(n, id).props[SYSTEM_IDS.colorField]?.[0];
  return value
    ? planSetProp(n, id, SYSTEM_IDS.colorField, { t: "str", v: value }, old)
    : planUnsetProp(n, id, SYSTEM_IDS.colorField, old);
}
export const planSetFieldType = (n: WireNode[], id: string, type: FieldType) =>
  schemaMutation(id, () => replaceProp(n, id, SYSTEM_IDS.fieldTypeField, [fieldTypeValue(type)]));
export const planAddFieldTargetTag = (n: WireNode[], id: string, tag: string) =>
  schemaMutation(id, () => refProp(n, id, SYSTEM_IDS.targetTagField, tag));
export const planRemoveFieldTargetTag = (n: WireNode[], id: string, tag: string) =>
  schemaMutation(id, () => unrefProp(n, id, SYSTEM_IDS.targetTagField, tag));
export function planSetFieldTargetQuery(n: WireNode[], id: string, edn: string | null) {
  mutableSchema(id);
  const value = edn?.trim() ?? "";
  return replaceProp(n, id, SYSTEM_IDS.targetQueryField, value ? [{ t: "str", v: value }] : []);
}

export const planSetViewMode = (n: WireNode[], id: string, mode: string) =>
  replaceProp(n, id, SYSTEM_IDS.viewModeField, [{ t: "str", v: mode }]);
export const planSetLensRenderer = (n: WireNode[], id: string, value: string) =>
  planSetLensProp(n, id, SYSTEM_IDS.lensRendererField, { t: "str", v: value });
export const planSetLensProp = (n: WireNode[], id: string, field: string, value: PropValue) =>
  replaceProp(n, id, field, [value]);
export function planSetViewSort(
  n: WireNode[],
  id: string,
  specs: Array<{ fieldId: string; dir: "asc" | "desc" }>,
): PlannedMutation {
  return replaceProps(n, id, [
    {
      field: SYSTEM_IDS.viewSortField,
      values: specs.map((spec) => ({ t: "ref", v: spec.fieldId })),
    },
    {
      field: SYSTEM_IDS.viewSortDirField,
      values: specs.map((spec) => ({ t: "str", v: spec.dir })),
    },
  ]);
}
export const planSetViewDisplay = (n: WireNode[], id: string, fields: string[]) =>
  replaceProp(
    n,
    id,
    SYSTEM_IDS.viewDisplayField,
    fields.map((v) => ({ t: "ref", v })),
  );
export const planSetViewColwidth = (n: WireNode[], id: string, widths: Record<string, number>) =>
  replaceProp(n, id, SYSTEM_IDS.viewColwidthField, [{ t: "str", v: JSON.stringify(widths) }]);
export const planSetViewPagesize = (n: WireNode[], id: string, size: number) =>
  replaceProp(n, id, SYSTEM_IDS.viewPagesizeField, [{ t: "num", v: size }]);
export const planSetViewGroup = (n: WireNode[], id: string, field: string | null) =>
  replaceProp(n, id, SYSTEM_IDS.viewGroupField, field !== null ? [{ t: "ref", v: field }] : []);
export const planSetViewFilters = (n: WireNode[], id: string, edn: string[]) =>
  replaceProp(
    n,
    id,
    SYSTEM_IDS.viewFilterField,
    edn.map((v) => ({ t: "str", v })),
  );
export const planMoveBoardCard = (
  n: WireNode[],
  id: string,
  field: string,
  _old: PropValue | null,
  value: PropValue | null,
) => replaceProp(n, id, field, value ? [value] : []);
