import type { ActionInvocation, WireNode } from "@kb/contracts";
import {
  familyViewIdOf,
  fieldTypeValue,
  hostViewIds,
  viewsWithDefault,
  siblingSlots,
  viewOptionId,
  wouldCreateExtendsCycle,
  type FieldType,
} from "@kb/model";
import { forestRootIds } from "@/lib/graph-view";
import { FRAME_VIEW_FAMILY } from "@kb/views";
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

/**
 * Replace fields' values as one `node.update`: `node.update` removes before it
 * adds, so a replacement is one transaction. Two — unset, then set — would
 * show every other client a window with no value, and two overlapping
 * replacements would leave a single-valued setting holding both.
 */
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
  if (unsetProps.length === 0 && setProps.length === 0) return plan();
  return update(id, {
    ...(unsetProps.length > 0 ? { unsetProps } : {}),
    ...(setProps.length > 0 ? { setProps } : {}),
  });
}

export const planReplaceField = (
  nodes: WireNode[],
  id: string,
  field: string,
  values: PropValue[],
) => replaceProps(nodes, id, [{ field, values }]);

export const planUpdateText = (_nodes: WireNode[], id: string, text: string) =>
  update(id, { text });
/**
 * Split a row's text at `cursor` into itself and a new row after it (or its
 * first child when it is an expanded parent). `"end"` splits after the whole
 * text, i.e. only creates the next row — what Enter means on a row whose shown
 * text is not its own (a contextual reference), where no offset the caret
 * reports is an offset into this node's text.
 */
export function planSplit(
  nodes: WireNode[],
  id: string,
  cursor: number | "end",
  newId: string,
  opts: { expandedIds: Set<string> },
): PlannedMutation {
  const node = requireNode(nodes, id);
  const at = cursor === "end" ? node.text.length : cursor;
  const left = node.text.slice(0, at);
  const right = node.text.slice(at);
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
  const grand = findParentWire(nodes, parent.id)?.id ?? null;
  return update(id, {
    parent: grand,
    position: groupIds(nodes, grand, id).indexOf(parent.id) + 1,
  });
}
export function planMove(
  nodes: WireNode[],
  id: string,
  direction: "up" | "down",
): PlannedMutation | null {
  const parent = findParentWire(nodes, id);
  const siblings = parent?.children ?? forestRootIds(nodes);
  const index = siblings.indexOf(id);
  const neighbour = siblings[direction === "up" ? index - 1 : index + 1];
  if (index < 0 || neighbour === undefined) return null;
  // Visible roots are a subsequence of the root group (fields, tags and
  // `sys.*` roots sit in it unseen), so the position is the neighbour's index
  // in the whole group: before it going up, after it going down.
  const group = groupIds(nodes, parent?.id ?? null, id);
  return update(id, { position: group.indexOf(neighbour) + (direction === "up" ? 0 : 1) });
}

/** Add `value`, replacing `oldValue` in the same `node.update` when given. */
export function planSetProp(
  _nodes: WireNode[],
  id: string,
  field: string,
  value: PropValue,
  oldValue?: PropValue,
): PlannedMutation {
  return update(id, {
    ...(oldValue === undefined ? {} : { unsetProps: [{ field, value: oldValue }] }),
    setProps: [{ field, value }],
  });
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
/**
 * Pin: one contextual reference appended to the Pinned list. No focus move —
 * pinning is a sidebar gesture, and stealing the caret from the row the user is
 * on would be a surprise the tag version never had.
 */
export function planPinNode(
  nodes: WireNode[],
  targetId: string,
  id: string,
): PlannedMutation | null {
  const list = wireById(nodes).get(SYSTEM_IDS.pinnedRoot);
  if (list === undefined) return null;
  return {
    actions: [
      {
        id: "node.add",
        input: {
          id,
          text: "",
          parent: SYSTEM_IDS.pinnedRoot,
          position: list.children.length,
          props: [{ field: SYSTEM_IDS.refTargetField, value: { t: "ref", v: targetId } }],
        },
      },
    ],
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

/**
 * The sibling group `id` joins under `parent` (null: the roots), in visible
 * order and without `id` — what a `position` indexes. The rank that position
 * implies is the server's to derive; the UI only says where.
 */
function groupIds(nodes: WireNode[], parent: string | null, id: string): string[] {
  return siblingSlots(nodes, parent, id).map((node) => node.id);
}

function addNode(
  id: string,
  text: string,
  {
    parent,
    position,
    props,
  }: { parent?: string; position?: number; props?: WireNode["props"] } = {},
): PlannedMutation {
  return {
    actions: [
      {
        id: "node.add",
        input: {
          id,
          text,
          ...(parent !== undefined ? { parent } : {}),
          ...(position !== undefined ? { position } : {}),
          ...(props
            ? {
                props: Object.entries(props).flatMap(([field, values]) =>
                  values.map((value) => ({ field, value })),
                ),
              }
            : {}),
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
  const parent = findParentWire(nodes, anchorId)?.id ?? null;
  const anchor = groupIds(nodes, parent, id).indexOf(anchorId);
  if (anchor < 0) throw new Error(`anchor not found: ${anchorId}`);
  const position = side === "after" ? anchor + 1 : anchor;
  return addNode(id, text, { ...(parent !== null ? { parent } : {}), position });
}
export const planInsertChild = (
  n: WireNode[],
  parent: string,
  index: number | "start" | "end",
  id: string,
  text = "",
) =>
  addNode(id, text, {
    parent,
    position:
      index === "start" ? 0 : index === "end" ? requireNode(n, parent).children.length : index,
  });
export const planAddRootNode = (text: string, id: string, props?: WireNode["props"]) =>
  addNode(id, text, { props });
export const planAddChild = (n: WireNode[], parent: string, id: string, text = "") =>
  addNode(id, text, { parent, position: requireNode(n, parent).children.length });
export const planPrependChild = (_n: WireNode[], parent: string, id: string, text = "") =>
  addNode(id, text, { parent, position: 0 });

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
  // One setting (`cardinality: one`), so showing it again replaces a stored
  // `false` rather than appending beside it.
  return hidden
    ? planReplaceField(n, id, SYSTEM_IDS.hiddenField, [{ t: "bool", v: true }])
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
  schemaMutation(id, () =>
    planReplaceField(n, id, SYSTEM_IDS.fieldTypeField, [fieldTypeValue(type)]),
  );
export const planAddFieldTargetTag = (n: WireNode[], id: string, tag: string) =>
  schemaMutation(id, () => refProp(n, id, SYSTEM_IDS.targetTagField, tag));
export const planRemoveFieldTargetTag = (n: WireNode[], id: string, tag: string) =>
  schemaMutation(id, () => unrefProp(n, id, SYSTEM_IDS.targetTagField, tag));
export function planSetFieldTargetQuery(n: WireNode[], id: string, edn: string | null) {
  mutableSchema(id);
  const value = edn?.trim() ?? "";
  return planReplaceField(
    n,
    id,
    SYSTEM_IDS.targetQueryField,
    value ? [{ t: "str", v: value }] : [],
  );
}

/** A graph view's renderer is its view: the option `sys.f.view` names. */
export const planSetGraphRenderer = (n: WireNode[], id: string, renderer: string) =>
  planReplaceField(n, id, SYSTEM_IDS.viewField, [{ t: "ref", v: renderer }]);
/**
 * A new view node, filed at the end of the Views list: the one place the UI
 * files the views it makes. A view node its host stops naming, or whose host
 * is deleted, stays filed there. GAP [[01M3YM5Y5XYDZ1C7G0PCQ1RMK8]]
 */
export function planAddViewNode(
  nodes: WireNode[],
  id: string,
  text: string,
  props: WireNode["props"],
): PlannedMutation | null {
  const list = wireById(nodes).get(SYSTEM_IDS.viewsList);
  if (list === undefined) return null;
  return {
    actions: addNode(id, text, {
      parent: SYSTEM_IDS.viewsList,
      position: list.children.length,
      props,
    }).actions,
  };
}
export const planSetLensProp = (n: WireNode[], id: string, field: string, value: PropValue) =>
  planReplaceField(n, id, field, [value]);
/**
 * What an edit of a frame's view writes: fields of its view node, each
 * replaced whole. The view is one of them (`sys.f.view`), its settings the
 * rest (DESIGN.md → Kinds, roles and options → View nodes).
 */
export type FrameViewEdit = ReadonlyArray<{ field: string; values: PropValue[] }>;

const refTo = (v: string): PropValue => ({ t: "ref", v });

export const frameViewIs = (option: string): FrameViewEdit => [
  { field: SYSTEM_IDS.viewField, values: [refTo(option)] },
];
export const frameViewSort = (specs: Array<{ fieldId: string; dir: "asc" | "desc" }>) => [
  { field: SYSTEM_IDS.viewSortField, values: specs.map((spec) => refTo(spec.fieldId)) },
  {
    field: SYSTEM_IDS.viewSortDirField,
    values: specs.map((spec): PropValue => ({ t: "str", v: spec.dir })),
  },
];
export const frameViewDisplay = (fields: string[]): FrameViewEdit => [
  { field: SYSTEM_IDS.viewDisplayField, values: fields.map(refTo) },
];
export const frameViewColwidth = (widths: Record<string, number>): FrameViewEdit => [
  { field: SYSTEM_IDS.viewColwidthField, values: [{ t: "str", v: JSON.stringify(widths) }] },
];
export const frameViewPagesize = (size: number): FrameViewEdit => [
  { field: SYSTEM_IDS.viewPagesizeField, values: [{ t: "num", v: size }] },
];
export const frameViewGroup = (field: string | null): FrameViewEdit => [
  { field: SYSTEM_IDS.viewGroupField, values: field !== null ? [refTo(field)] : [] },
];
export const frameViewFilters = (edn: string[]): FrameViewEdit => [
  { field: SYSTEM_IDS.viewFilterField, values: edn.map((v): PropValue => ({ t: "str", v })) },
];

/**
 * Make `viewId` `hostId`'s default view: move it first in the host's
 * `sys.f.views`, one replacement of the field (DESIGN.md → View nodes). Null
 * when the host does not name it.
 */
export function planMakeDefaultView(
  nodes: WireNode[],
  hostId: string,
  viewId: string,
): PlannedMutation | null {
  const host = requireNode(nodes, hostId);
  if (!hostViewIds(host).includes(viewId)) return null;
  return replaceProps(nodes, hostId, [
    { field: SYSTEM_IDS.viewsField, values: viewsWithDefault(host, viewId).map(refTo) },
  ]);
}

/** What a frame is shown as until it names a frame view node: the list. */
const FRAME_LIST_OPTION = viewOptionId("outline.list");

/**
 * Edit a frame's view: the first frame view node it names (`familyViewIdOf`,
 * the one its children are shown through), its fields replaced in one
 * `node.update`. A view of another kind named first (a snippet, a
 * neighbourhood) is never rewritten. A frame that names no frame view node
 * gets one — the list's, filed in the Views list under `newViewId`, carrying
 * the edit — named first in `sys.f.views`, so it is the frame's default.
 * Null when there is no Views list to file it in.
 */
export function planEditFrameView(
  nodes: WireNode[],
  frameId: string,
  edit: FrameViewEdit,
  newViewId: string,
): PlannedMutation | null {
  const frame = requireNode(nodes, frameId);
  const byId = wireById(nodes);
  const viewId = familyViewIdOf(frame, FRAME_VIEW_FAMILY, (id) => byId.get(id));
  if (viewId !== null) return replaceProps(nodes, viewId, [...edit]);
  const props: WireNode["props"] = {
    [SYSTEM_IDS.viewField]: [refTo(FRAME_LIST_OPTION)],
    ...Object.fromEntries(edit.map(({ field, values }) => [field, values])),
  };
  const made = planAddViewNode(nodes, newViewId, "", props);
  if (made === null) return null;
  const views = viewsWithDefault(frame, newViewId);
  const named = replaceProps(nodes, frameId, [
    { field: SYSTEM_IDS.viewsField, values: views.map(refTo) },
  ]);
  return { actions: [...made.actions, ...named.actions] };
}
export const planMoveBoardCard = (
  n: WireNode[],
  id: string,
  field: string,
  _old: PropValue | null,
  value: PropValue | null,
) => planReplaceField(n, id, field, value ? [value] : []);
