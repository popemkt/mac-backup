import {
  isSysPrefixed,
  logWarn,
  SYSTEM_IDS,
  textOr,
  type OutlineNode,
  type PropValue,
  type SchemaIndex,
} from "@kb/ui-sdk";
import { Result } from "effect";
import { familyViewIdOf, viewOptionId, viewOptionOf, type NodeProps } from "@kb/model";
import {
  FRAME_VIEW_FAMILY,
  decodeFrameConfig,
  paramsFromProps,
  type FrameViewKey,
  type FrameViewParams,
  type SortSpec,
  type ViewConfig,
  type ViewFilter,
} from "@kb/views";
import { viewKeyOfNode } from "@/lib/view-node";

function propValueKey(v: PropValue, _schema: SchemaIndex): string {
  if (v.t === "ref") return `ref:${v.v}`;
  if (v.t === "bool") return `bool:${v.v ? 1 : 0}`;
  if (v.t === "num") return `num:${v.v}`;
  return `str:${v.v}`;
}

function propValueLabel(v: PropValue, schema: SchemaIndex): string {
  if (v.t === "ref") return textOr(schema.get(v.v)?.text, v.v);
  if (v.t === "bool") return v.v ? "true" : "false";
  return String(v.v);
}

function matchesFilter(node: OutlineNode, filter: ViewFilter, schema: SchemaIndex): boolean {
  if (filter.kind === "text") {
    const q = filter.text.toLowerCase();
    if (!q) return true;
    if (node.text.toLowerCase().includes(q)) return true;
    for (const vals of Object.values(node.props)) {
      for (const v of vals) {
        if (propValueLabel(v, schema).toLowerCase().includes(q)) return true;
      }
    }
    return false;
  }

  const vals = node.props[filter.fieldId] ?? [];
  if (vals.length === 0) return false;
  return vals.some((v) => {
    if (v.t === "ref") return v.v === filter.value || propValueLabel(v, schema) === filter.value;
    return String(v.v) === filter.value;
  });
}

/** Apply view filters (AND). Empty filters = identity. */
export function applyViewFilters(
  children: OutlineNode[],
  filters: readonly ViewFilter[],
  schema: SchemaIndex,
): OutlineNode[] {
  if (filters.length === 0) return children;
  return children.filter((n) => filters.every((f) => matchesFilter(n, f, schema)));
}

/**
 * A view frame's configuration (`@kb/views`' `decodeFrameConfig`), with what
 * it had to ignore reported through the ui log seam.
 */
export function getViewConfig(props?: NodeProps): ViewConfig {
  return decodeFrameConfig(props, frameReport);
}

/** Where a frame setting the UI had to ignore goes: the log. */
export function frameReport(warning: string): void {
  logWarn(`[view-config] ${warning}`);
}

/** A frame's view, resolved: which one, and the settings it renders from. */
export interface FrameView {
  readonly key: FrameViewKey;
  readonly params: FrameViewParams;
}

/** A node as the frame-view readers need it: its id and props. */
interface ViewCarrier {
  readonly id: string;
  readonly props: NodeProps;
}

/**
 * The id of the view node a frame shows its children through: the first
 * view node its `sys.f.views` names whose view is a frame view
 * (`familyViewIdOf`, DESIGN.md → View nodes). That is its default unless it
 * names another kind of view first (a snippet, a neighbourhood), which a
 * frame edit never rewrites. Null when it names none.
 *
 * It is read from the schema, the whole graph: how a frame is shown is what
 * its content means, not content an ontology scope chooses, so a frame in a
 * scope keeps a view node that is no member of it.
 */
export function frameViewNodeIdOf(
  frame: { readonly props: NodeProps } | undefined,
  schema: SchemaIndex,
): string | null {
  return familyViewIdOf(frame, FRAME_VIEW_FAMILY, (id) => schema.get(id));
}

/** The view node {@link frameViewNodeIdOf} names, or null. */
function frameViewNodeOf(
  frame: { readonly props: NodeProps } | undefined,
  schema: SchemaIndex,
): ViewCarrier | null {
  const id = frameViewNodeIdOf(frame, schema);
  return (id === null ? undefined : schema.get(id)) ?? null;
}

/** Every frame setting a frame's view node holds, decoded (the defaults when it has none). */
export function frameConfigOf(
  frame: { readonly props: NodeProps } | undefined,
  schema: SchemaIndex,
): ViewConfig {
  return getViewConfig(frameViewNodeOf(frame, schema)?.props);
}

/** What a frame is shown as while its view node names no frame view: the list. */
const LIST_OPTION = viewOptionId("outline.list");

/**
 * The view a frame shows its children in, among the frame views provided
 * (`views`, as `ViewPoint` lists them): the one its view node names, else the
 * list's, with the view node's props decoded through that view's params for
 * the frame, so it carries exactly the settings the view reads. Null while
 * not even the list is provided.
 */
export function frameViewOf(
  frame: ViewCarrier | undefined,
  schema: SchemaIndex,
  views: readonly FrameViewKey[],
): FrameView | null {
  return frameViewThrough(frame, frameViewNodeOf(frame, schema), views);
}

/** {@link frameViewOf}, given the frame's view node (`frameViewNodeOf`) already looked up. */
export function frameViewThrough(
  frame: ViewCarrier | undefined,
  node: ViewCarrier | null,
  views: readonly FrameViewKey[],
): FrameView | null {
  const asked = viewKeyOfNode(node ?? undefined, views);
  if (node !== null && asked === null)
    logWarn(`[view-config] ${node.id} ignored: ${viewOptionOf(node)} is no frame view provided`);
  const key = asked ?? views.find((view) => view.option === LIST_OPTION);
  if (key === undefined) return null;
  const params = paramsFromProps(key, node?.props ?? {}, frame?.id ?? null, frameReport);
  if (Result.isSuccess(params)) return { key, params: params.success };
  // Unreachable while every setting is decoded by the schema the params are made of.
  logWarn(`[view-config] ${key.id} cannot read this frame: ${params.failure}`);
  return null;
}

export interface TableColumnSpec {
  fieldId: string;
  label: string;
}

/** A field id paired with the label a column header shows. */
function toColumnSpec(fieldId: string, schema: SchemaIndex): TableColumnSpec {
  return { fieldId, label: textOr(schema.get(fieldId)?.text, fieldId) };
}

function isHiddenField(fieldId: string, schema: SchemaIndex): boolean {
  return schema.get(fieldId)?.props[SYSTEM_IDS.hiddenField]?.[0]?.v === true;
}

/**
 * The columns the frame names for itself, or null when it names none.
 *
 * `null` rather than `[]` on purpose: a frame that names only hidden fields
 * has *made a choice*, and showing no columns is that choice honoured. See
 * {@link mergeColumns}.
 *
 * A named `sys.` field is kept — naming one is itself the decision that it
 * belongs on the table, which is the asymmetry with derivation below.
 */
function explicitColumns(
  display: readonly string[],
  schema: SchemaIndex,
  showDebugColumns: boolean,
): TableColumnSpec[] | null {
  if (display.length === 0) return null;
  return display
    .filter((fieldId) => showDebugColumns || !isHiddenField(fieldId, schema))
    .map((fieldId) => toColumnSpec(fieldId, schema));
}

/**
 * The columns the projected rows' own tags imply, in first-seen order.
 *
 * Nobody asked for these, so infrastructure stays out: a `sys.` field or a
 * field marked hidden is not offered by derivation.
 */
function derivedColumns(
  children: readonly OutlineNode[],
  schema: SchemaIndex,
  showDebugColumns: boolean,
): TableColumnSpec[] {
  const seen = new Set<string>();
  const columns: TableColumnSpec[] = [];
  for (const child of children) {
    for (const tag of child.tags) {
      const tagNode = schema.get(tag.id);
      if (!tagNode) continue;
      for (const ref of tagNode.props[SYSTEM_IDS.fieldsField] ?? []) {
        if (ref.t !== "ref" || seen.has(ref.v)) continue;
        seen.add(ref.v);
        if (!showDebugColumns && (isSysPrefixed(ref.v) || isHiddenField(ref.v, schema))) continue;
        columns.push(toColumnSpec(ref.v, schema));
      }
    }
  }
  return columns;
}

/**
 * The precedence, in one place: naming columns on the frame replaces
 * derivation outright. It used to be implicit in statement order.
 */
function mergeColumns(
  explicit: TableColumnSpec[] | null,
  derived: () => TableColumnSpec[],
): TableColumnSpec[] {
  return explicit ?? derived();
}

export function resolveTableColumns(
  viewConfig: { readonly display: readonly string[] },
  children: OutlineNode[],
  schema: SchemaIndex,
  showDebugColumns = false,
): TableColumnSpec[] {
  return mergeColumns(explicitColumns(viewConfig.display, schema, showDebugColumns), () =>
    derivedColumns(children, schema, showDebugColumns),
  );
}

/**
 * Reading one sort key off a row.
 *
 * The node's text is a field (`sys.f.node.text`) whose value is read off the
 * node rather than its props — not a branch in the comparator: once it
 * resolves to a `PropValue` like any other key, one ordering rule serves both,
 * and "the name is never missing" stops being a special case.
 */
const PSEUDO_FIELDS: Readonly<Record<string, (node: OutlineNode) => PropValue>> = {
  [SYSTEM_IDS.nodeTextField]: (node) => ({ t: "str", v: node.text }),
};

function sortValueOf(node: OutlineNode, fieldId: string): PropValue | undefined {
  const pseudo = PSEUDO_FIELDS[fieldId];
  if (pseudo) return pseudo(node);
  // Display and drag both take the first value; so does ordering.
  return node.props[fieldId]?.[0];
}

function byLowerString(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A value type's sort key: one row per type, which is what the comparator's
 * `else if` ladder made invisible. Numbers stay numbers so 10 sorts after 9;
 * everything else compares as a lowercased string.
 */
type SortKey = number | string;

const SORT_KEY: Readonly<
  Record<PropValue["t"], (value: PropValue, schema: SchemaIndex) => SortKey>
> = {
  num: (value) => Number(value.v),
  bool: (value) => (value.v === true ? 1 : 0),
  ref: (value, schema) => textOr(schema.get(String(value.v))?.text, String(value.v)).toLowerCase(),
  str: (value) => String(value.v).toLowerCase(),
  date: (value) => String(value.v).toLowerCase(),
};

function compareKeys(a: SortKey, b: SortKey): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return byLowerString(String(a), String(b));
}

/**
 * Two rows' values for one key.
 *
 * A missing value sorts last — before the direction is applied, so descending
 * puts it first. Two values of *different* types are compared as their raw
 * strings rather than through either one's key: a ref mixed with a string has
 * no shared ordering, and reaching for the ref's resolved text there would be
 * inventing one.
 */
function compareValues(
  a: PropValue | undefined,
  b: PropValue | undefined,
  schema: SchemaIndex,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.t !== b.t) return byLowerString(String(a.v), String(b.v));
  return compareKeys(SORT_KEY[a.t](a, schema), SORT_KEY[b.t](b, schema));
}

type RowComparator = (a: OutlineNode, b: OutlineNode) => number;

/** One sort key, in one direction. */
function compareByField(spec: SortSpec, schema: SchemaIndex): RowComparator {
  return (a, b) => {
    const cmp = compareValues(sortValueOf(a, spec.fieldId), sortValueOf(b, spec.fieldId), schema);
    return spec.dir === "asc" ? cmp : -cmp;
  };
}

/** First key that separates two rows wins; ties fall through to the next. */
function composeComparators(comparators: readonly RowComparator[]): RowComparator {
  return (a, b) => {
    for (const compare of comparators) {
      const cmp = compare(a, b);
      if (cmp !== 0) return cmp;
    }
    return 0;
  };
}

export function sortChildrenForTable(
  children: OutlineNode[],
  sortSpecs: readonly SortSpec[],
  schema: SchemaIndex,
): OutlineNode[] {
  if (sortSpecs.length === 0) return children;
  return children.toSorted(
    composeComparators(sortSpecs.map((spec) => compareByField(spec, schema))),
  );
}

export const EMPTY_GROUP_KEY = "__empty__";

export interface BoardColumn {
  key: string;
  label: string;
  /** Prop value for this column; null = "No <field>" empty column. */
  value: PropValue | null;
  nodes: OutlineNode[];
}

/**
 * Group direct children by view.group field values.
 * When groupFieldId is null (cards), returns a single unlabeled column.
 */
export function groupChildrenForBoard(
  children: OutlineNode[],
  groupFieldId: string | null,
  schema: SchemaIndex,
): BoardColumn[] {
  if (groupFieldId === null) {
    return [
      {
        key: "__all__",
        label: "",
        value: null,
        nodes: [...children],
      },
    ];
  }

  const fieldLabel = textOr(schema.get(groupFieldId)?.text, groupFieldId);
  const columns = new Map<string, BoardColumn>();
  const empty: BoardColumn = {
    key: EMPTY_GROUP_KEY,
    label: `No ${fieldLabel}`,
    value: null,
    nodes: [],
  };

  for (const child of children) {
    const vals = child.props[groupFieldId] ?? [];
    if (vals.length === 0) {
      empty.nodes.push(child);
      continue;
    }
    // Display: first value wins. Drag clears all values then sets one.
    const [v] = vals;
    if (v === undefined) continue;
    const key = propValueKey(v, schema);
    let col = columns.get(key);
    if (!col) {
      col = {
        key,
        label: propValueLabel(v, schema),
        value: v,
        nodes: [],
      };
      columns.set(key, col);
    }
    col.nodes.push(child);
  }

  const ordered = [...columns.values()].toSorted((a, b) => a.label.localeCompare(b.label));
  ordered.push(empty);
  return ordered;
}

/** Flatten board columns to render-order node list (visible-instances). */
export function flattenBoardOrder(columns: BoardColumn[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const col of columns) {
    out.push(...col.nodes);
  }
  return out;
}
