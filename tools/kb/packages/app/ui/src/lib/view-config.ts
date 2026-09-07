import { Schema } from "effect";
import {
  decodeNodeConfig,
  firstStr,
  manyOf,
  oneOf,
  type ConfigSlots,
  type NodeProps,
} from "@kb/model";
import type { NodeMap, OutlineNode, PropValue } from "./types";
import { isSysPrefixed, SYSTEM_IDS } from "./types";
import { logWarn } from "@/lib/log";
import { textOr } from "@/lib/text";

export type ViewMode = "list" | "table" | "board" | "cards";
export type SortDir = "asc" | "desc";

export interface SortSpec {
  fieldId: string;
  dir: SortDir;
}

/** Parsed sys.f.view.filter EDN clause. */
export type ViewFilter =
  | { kind: "eq"; fieldId: string; value: string; raw: string }
  | { kind: "text"; text: string; raw: string };

export interface ViewConfig {
  mode: ViewMode;
  sort: SortSpec[];
  display: string[];
  colwidth: Record<string, number>;
  pagesize: number;
  /** Board group-by field id (null = ungrouped / cards). */
  groupFieldId: string | null;
  filters: ViewFilter[];
}

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  mode: "list",
  sort: [],
  display: [],
  colwidth: {},
  pagesize: 100,
  groupFieldId: null,
  filters: [],
};

const VIEW_MODES: readonly ViewMode[] = ["list", "table", "board", "cards"];

/** Serialize a filter back to the EDN string stored on the frame. */
export function serializeViewFilter(filter: Exclude<ViewFilter, never> & { raw?: string }): string {
  if (filter.kind === "text") {
    return `{:text ${JSON.stringify(filter.text)}}`;
  }
  return `{:field ${filter.fieldId} :eq ${JSON.stringify(filter.value)}}`;
}

/**
 * Parse filter EDN: `{:field <id> :eq <value>}` or `{:text "substr"}`.
 * Bad EDN → null (caller warns); never throws.
 */
export function parseViewFilterEdn(edn: string): ViewFilter | null {
  const raw = edn.trim();
  if (!raw.startsWith("{") || !raw.endsWith("}")) return null;

  const textValue = raw.match(/^\{:text\s+"((?:\\.|[^"\\])*)"\s*\}$/)?.[1];
  if (textValue !== undefined) {
    return {
      kind: "text",
      text: textValue.replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      raw,
    };
  }

  // {:field <id> :eq "value"} | {:field <id> :eq bare}
  const eqMatch = raw.match(/^\{:field\s+(\S+)\s+:eq\s+(?:"((?:\\.|[^"\\])*)"|(\S+))\s*\}$/);
  if (eqMatch) {
    const [, fieldId, quoted, bare] = eqMatch;
    const value =
      quoted === undefined
        ? bare?.replace(/^:/, "")
        : quoted.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (fieldId !== undefined && value !== undefined) {
      return { kind: "eq", fieldId, value, raw };
    }
  }

  return null;
}

function propValueKey(v: PropValue, _nodes: NodeMap): string {
  if (v.t === "ref") return `ref:${v.v}`;
  if (v.t === "bool") return `bool:${v.v ? 1 : 0}`;
  if (v.t === "num") return `num:${v.v}`;
  return `str:${v.v}`;
}

function propValueLabel(v: PropValue, nodes: NodeMap): string {
  if (v.t === "ref") return textOr(nodes.get(v.v)?.text, v.v);
  if (v.t === "bool") return v.v ? "true" : "false";
  return String(v.v);
}

function matchesFilter(node: OutlineNode, filter: ViewFilter, nodes: NodeMap): boolean {
  if (filter.kind === "text") {
    const q = filter.text.toLowerCase();
    if (!q) return true;
    if (node.text.toLowerCase().includes(q)) return true;
    for (const vals of Object.values(node.props)) {
      for (const v of vals) {
        if (propValueLabel(v, nodes).toLowerCase().includes(q)) return true;
      }
    }
    return false;
  }

  const vals = node.props[filter.fieldId] ?? [];
  if (vals.length === 0) return false;
  return vals.some((v) => {
    if (v.t === "ref") return v.v === filter.value || propValueLabel(v, nodes) === filter.value;
    return String(v.v) === filter.value;
  });
}

/** Apply view filters (AND). Empty filters = identity. */
export function applyViewFilters(
  children: OutlineNode[],
  filters: ViewFilter[],
  nodes: NodeMap,
): OutlineNode[] {
  if (filters.length === 0) return children;
  return children.filter((n) => filters.every((f) => matchesFilter(n, f, nodes)));
}

/*
 * The view frame's props, as one slot table.
 *
 * Same mechanism as `graph-lens.ts`'s perspective table (`@kb/model`'s
 * `node-config`): a slot names the field it reads, the carrier reader that
 * projects the stored values, the `Schema` that says what is legal, and the
 * value used when the frame says nothing. Nothing else in this file decides a
 * default.
 */

/** Sort keys and their directions are two parallel multi-valued fields. */
const sortSpecValues = (props: NodeProps): unknown[] | undefined => {
  const keys = props[SYSTEM_IDS.viewSortField];
  if (keys === undefined) return undefined;
  const dirs = props[SYSTEM_IDS.viewSortDirField] ?? [];
  return keys.map((key, index) => {
    // A value that is not a field reference is not a sort key, and the schema
    // is what says so — passing it through is what gets it reported.
    if (key.t !== "ref") return key;
    // A direction with no string at this index is unset, so it takes the
    // declared default; a string that is present is the schema's to judge.
    const dir = dirs[index];
    return { fieldId: key.v, dir: dir?.t === "str" ? dir.v : "asc" };
  });
};

const SortSpecSchema = Schema.Struct({
  fieldId: Schema.NonEmptyString,
  dir: Schema.Literals(["asc", "desc"]),
});

/**
 * A column is a field reference. A column listed twice is one column, so a
 * repeat decodes to `null` — a value that legitimately contributes nothing —
 * while a value that is no reference at all is left for the schema to reject.
 */
const displayValues = (props: NodeProps): unknown[] | undefined => {
  const values = props[SYSTEM_IDS.viewDisplayField];
  if (values === undefined) return undefined;
  const seen = new Set<string>();
  return values.map((value) => {
    if (value.t !== "ref") return value;
    if (seen.has(value.v)) return null;
    seen.add(value.v);
    return value.v;
  });
};

/**
 * `sys.f.view.colwidth` stores a JSON object of field id → pixel width. The
 * reader gets the object out of the text; the schema says what a width is.
 */
const colwidthValue = (props: NodeProps): unknown => {
  const raw = firstStr(SYSTEM_IDS.viewColwidthField)(props);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  return parsed;
};

/** A page size may be stored as a number or as the text a form wrote. */
const pagesizeValue = (props: NodeProps): unknown => {
  const first = props[SYSTEM_IDS.viewPagesizeField]?.[0];
  if (first?.t === "num") return first.v;
  if (first?.t !== "str") return undefined;
  const parsed = parseInt(first.v, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const PositiveSchema = Schema.Finite.check(Schema.isGreaterThan(0));

const WidthsSchema = Schema.Record(Schema.String, PositiveSchema);

const ViewFilterSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("eq"),
    fieldId: Schema.NonEmptyString,
    value: Schema.String,
    raw: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("text"),
    text: Schema.String,
    raw: Schema.String,
  }),
]);

/**
 * A filter is stored as EDN text, so reading the clause out of the text is the
 * carrier step and the schema validates the clause it produced.
 */
const filterValues = (props: NodeProps): unknown[] | undefined =>
  props[SYSTEM_IDS.viewFilterField]?.map((value) => {
    if (value.t !== "str") return value;
    return parseViewFilterEdn(value.v) ?? value.v;
  });

const VIEW_SLOTS: ConfigSlots<ViewConfig> = {
  mode: oneOf({
    fields: [SYSTEM_IDS.viewModeField],
    read: firstStr(SYSTEM_IDS.viewModeField),
    schema: Schema.Literals(VIEW_MODES),
    fallback: DEFAULT_VIEW_CONFIG.mode,
  }),
  sort: manyOf<SortSpec>({
    fields: [SYSTEM_IDS.viewSortField, SYSTEM_IDS.viewSortDirField],
    read: sortSpecValues,
    schema: Schema.NullOr(SortSpecSchema),
    fallback: DEFAULT_VIEW_CONFIG.sort,
  }),
  display: manyOf<string>({
    fields: [SYSTEM_IDS.viewDisplayField],
    read: displayValues,
    schema: Schema.NullOr(Schema.NonEmptyString),
    fallback: DEFAULT_VIEW_CONFIG.display,
  }),
  colwidth: oneOf({
    fields: [SYSTEM_IDS.viewColwidthField],
    read: colwidthValue,
    schema: WidthsSchema,
    fallback: DEFAULT_VIEW_CONFIG.colwidth,
  }),
  pagesize: oneOf({
    fields: [SYSTEM_IDS.viewPagesizeField],
    read: pagesizeValue,
    schema: PositiveSchema,
    fallback: DEFAULT_VIEW_CONFIG.pagesize,
  }),
  groupFieldId: oneOf<string | null>({
    fields: [SYSTEM_IDS.viewGroupField],
    read: (props) => {
      const first = props[SYSTEM_IDS.viewGroupField]?.[0];
      return first?.t === "ref" ? first.v : undefined;
    },
    schema: Schema.NonEmptyString,
    fallback: DEFAULT_VIEW_CONFIG.groupFieldId,
  }),
  filters: manyOf<ViewFilter>({
    fields: [SYSTEM_IDS.viewFilterField],
    read: filterValues,
    schema: ViewFilterSchema,
    fallback: DEFAULT_VIEW_CONFIG.filters,
  }),
};

/**
 * Decode a view frame's configuration.
 *
 * A malformed view prop falls back to its declared default and is reported
 * through the ui log seam; it never fails the frame, because a bad prop must
 * not make the outline unopenable.
 */
export function getViewConfig(props?: Record<string, PropValue[]>): ViewConfig {
  const slot = decodeNodeConfig<ViewConfig>(VIEW_SLOTS, props, (warning) =>
    logWarn(`[view-config] ${warning}`),
  );
  return {
    mode: slot("mode"),
    sort: slot("sort"),
    display: slot("display"),
    colwidth: slot("colwidth"),
    pagesize: slot("pagesize"),
    groupFieldId: slot("groupFieldId"),
    filters: slot("filters"),
  };
}

export interface TableColumnSpec {
  fieldId: string;
  label: string;
}

/** A field id paired with the label a column header shows. */
function toColumnSpec(fieldId: string, nodes: NodeMap): TableColumnSpec {
  return { fieldId, label: textOr(nodes.get(fieldId)?.text, fieldId) };
}

function isHiddenField(fieldId: string, nodes: NodeMap): boolean {
  return nodes.get(fieldId)?.props[SYSTEM_IDS.hiddenField]?.[0]?.v === true;
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
  nodes: NodeMap,
  showDebugColumns: boolean,
): TableColumnSpec[] | null {
  if (display.length === 0) return null;
  return display
    .filter((fieldId) => showDebugColumns || !isHiddenField(fieldId, nodes))
    .map((fieldId) => toColumnSpec(fieldId, nodes));
}

/**
 * The columns the projected rows' own tags imply, in first-seen order.
 *
 * Nobody asked for these, so infrastructure stays out: a `sys.` field or a
 * field marked hidden is not offered by derivation.
 */
function derivedColumns(
  children: readonly OutlineNode[],
  nodes: NodeMap,
  showDebugColumns: boolean,
): TableColumnSpec[] {
  const seen = new Set<string>();
  const columns: TableColumnSpec[] = [];
  for (const child of children) {
    for (const tag of child.tags) {
      const tagNode = nodes.get(tag.id);
      if (!tagNode) continue;
      for (const ref of tagNode.props[SYSTEM_IDS.fieldsField] ?? []) {
        if (ref.t !== "ref" || seen.has(ref.v)) continue;
        seen.add(ref.v);
        if (!showDebugColumns && (isSysPrefixed(ref.v) || isHiddenField(ref.v, nodes))) continue;
        columns.push(toColumnSpec(ref.v, nodes));
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
  viewConfig: ViewConfig,
  children: OutlineNode[],
  nodes: NodeMap,
  showDebugColumns = false,
): TableColumnSpec[] {
  return mergeColumns(explicitColumns(viewConfig.display, nodes, showDebugColumns), () =>
    derivedColumns(children, nodes, showDebugColumns),
  );
}

/** `__name__` is the node's own text standing in for a field. */
const NAME_FIELD_ID = "__name__";

/**
 * Reading one sort key off a row.
 *
 * The node's text is a pseudo-field rather than a branch in the comparator:
 * once it resolves to a `PropValue` like any other key, one ordering rule
 * serves both, and "the name is never missing" stops being a special case.
 */
const PSEUDO_FIELDS: Readonly<Record<string, (node: OutlineNode) => PropValue>> = {
  [NAME_FIELD_ID]: (node) => ({ t: "str", v: node.text }),
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

const SORT_KEY: Readonly<Record<PropValue["t"], (value: PropValue, nodes: NodeMap) => SortKey>> = {
  num: (value) => Number(value.v),
  bool: (value) => (value.v === true ? 1 : 0),
  ref: (value, nodes) => textOr(nodes.get(String(value.v))?.text, String(value.v)).toLowerCase(),
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
function compareValues(a: PropValue | undefined, b: PropValue | undefined, nodes: NodeMap): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.t !== b.t) return byLowerString(String(a.v), String(b.v));
  return compareKeys(SORT_KEY[a.t](a, nodes), SORT_KEY[b.t](b, nodes));
}

type RowComparator = (a: OutlineNode, b: OutlineNode) => number;

/** One sort key, in one direction. */
function compareByField(spec: SortSpec, nodes: NodeMap): RowComparator {
  return (a, b) => {
    const cmp = compareValues(sortValueOf(a, spec.fieldId), sortValueOf(b, spec.fieldId), nodes);
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
  sortSpecs: SortSpec[],
  nodes: NodeMap,
): OutlineNode[] {
  if (sortSpecs.length === 0) return children;
  return children.toSorted(
    composeComparators(sortSpecs.map((spec) => compareByField(spec, nodes))),
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
  nodes: NodeMap,
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

  const fieldLabel = textOr(nodes.get(groupFieldId)?.text, groupFieldId);
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
    const key = propValueKey(v, nodes);
    let col = columns.get(key);
    if (!col) {
      col = {
        key,
        label: propValueLabel(v, nodes),
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

/** True when mode renders a flat projected view (not nested list). */
export function isProjectedViewMode(mode: ViewMode): boolean {
  return mode === "table" || mode === "board" || mode === "cards";
}
