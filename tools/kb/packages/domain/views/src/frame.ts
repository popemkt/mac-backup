/**
 * The outline's frame views as data: the settings a frame's view node
 * stores (`sys.f.view.*`), as one slot table, how they decode, and what every
 * frame view's key is. How a frame's rows are filtered, sorted, grouped and
 * laid out from those settings is the UI's (`@kb/ui`'s `lib/view-config.ts`).
 */
import { Schema } from "effect";
import {
  SYSTEM_IDS,
  decodeNodeConfig,
  firstStr,
  manyOf,
  oneOf,
  type ConfigSlots,
  type NodeProps,
} from "@kb/model";
import type { ConfigReport, ViewKey } from "./view-key.ts";

export type SortDir = "asc" | "desc";

export interface SortSpec {
  fieldId: string;
  dir: SortDir;
}

/** Parsed sys.f.view.filter EDN clause. */
export type ViewFilter =
  | { kind: "eq"; fieldId: string; value: string; raw: string }
  | { kind: "text"; text: string; raw: string };

/**
 * Every setting any frame view reads, decoded from a frame's view node's
 * `sys.f.view.*` props. A view reads only the ones its params declare
 * ({@link frameViewOf}).
 */
export interface ViewConfig {
  sort: SortSpec[];
  display: string[];
  colwidth: Record<string, number>;
  pagesize: number;
  /** Board group-by field id (null = ungrouped / cards). */
  groupFieldId: string | null;
  filters: ViewFilter[];
}

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  sort: [],
  display: [],
  colwidth: {},
  pagesize: 100,
  groupFieldId: null,
  filters: [],
};

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

/*
 * The view frame's props, as one slot table.
 *
 * Same mechanism as `graph-lens.ts`'s perspective table (`@kb/model`'s
 * `node-config`): a slot names the field it reads, the carrier reader that
 * projects the stored values, the `Schema` that says what is legal, and the
 * value used when the frame says nothing. Nothing else in this file decides a
 * default.
 */

/**
 * The id a view names a column by, read the way it is written today.
 *
 * Before the Name column was the `sys.f.node.text` field node, a view named it
 * with the sentinel `"__name__"`, and stores still hold sorts and widths saved
 * that way. Resolving the sentinel here, in the readers, makes the next persist
 * of either config write the real id — so there is no migration pass, and no
 * consumer ever sees the sentinel.
 */
const LEGACY_NAME_COLUMN = "__name__";
function columnFieldId(id: string): string {
  return id === LEGACY_NAME_COLUMN ? SYSTEM_IDS.nodeTextField : id;
}

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
    return { fieldId: columnFieldId(key.v), dir: dir?.t === "str" ? dir.v : "asc" };
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
  // A width saved under the real id wins over one saved under the sentinel.
  const widths = new Map<string, unknown>(Object.entries(parsed));
  const legacy = widths.get(LEGACY_NAME_COLUMN);
  widths.delete(LEGACY_NAME_COLUMN);
  const name = columnFieldId(LEGACY_NAME_COLUMN);
  if (legacy !== undefined && !widths.has(name)) widths.set(name, legacy);
  return Object.fromEntries(widths);
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

/**
 * The outline's frame views: the ways a frame shows its children, each a view
 * in `ViewPoint`. Their keys are data (`outline.ts`); this module states what
 * every one of them is. How a frame's props resolve to one of the views
 * provided, which the store's row walk asks too, is the UI's.
 */

/** The discriminant a frame view's key carries (`ViewKey.family`). */
export const FRAME_VIEW_FAMILY = "outline.frame";

/**
 * Each setting a frame view may read, with its schema — built from the same
 * element schemas the slots below validate the stored props with. A frame
 * view's params are made of these, so a view declares the settings it reads
 * by naming them here.
 */
export const FRAME_SETTINGS = {
  filters: Schema.Array(ViewFilterSchema),
  sort: Schema.Array(SortSpecSchema),
  display: Schema.Array(Schema.NonEmptyString),
  colwidth: WidthsSchema,
  pagesize: PositiveSchema,
  groupFieldId: Schema.NullOr(Schema.NonEmptyString),
};

/** The settings any frame view's params may carry; filters are every view's. */
export interface FrameViewParams {
  readonly filters: readonly ViewFilter[];
  readonly sort?: readonly SortSpec[];
  readonly display?: readonly string[];
  readonly colwidth?: Readonly<Record<string, number>>;
  readonly pagesize?: number;
  readonly groupFieldId?: string | null;
}

/**
 * A frame view's key: data only, the trait the row walk needs beside the
 * params. `rows` is how it lays out the frame's rows: `outline` nests, each
 * row hosting its own children in turn; `rows` is one flat run; `columns`
 * groups flat rows into columns. What happens to the rows follows from the
 * params: it sorts when they declare `sort`, pages when they declare
 * `pagesize`, and groups its columns by a field when they declare
 * `groupFieldId`.
 */
export interface FrameViewKey<P extends FrameViewParams = FrameViewParams> extends ViewKey<P> {
  readonly family: typeof FRAME_VIEW_FAMILY;
  readonly rows: "outline" | "rows" | "columns";
}

export function isFrameViewKey(key: ViewKey<unknown>): key is FrameViewKey {
  return key.family === FRAME_VIEW_FAMILY;
}

/** Whether a view projects the frame's rows flat, instead of nesting them as the outline does. */
export function projectsRows(view: FrameViewKey | null): boolean {
  return view !== null && view.rows !== "outline";
}

const VIEW_SLOTS: ConfigSlots<ViewConfig> = {
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
 * A malformed view prop falls back to its declared default and goes to
 * `report`; it never fails the frame, because a bad prop must not make the
 * outline unopenable.
 */
export function decodeFrameConfig(props: NodeProps | undefined, report: ConfigReport): ViewConfig {
  const slot = decodeNodeConfig<ViewConfig>(VIEW_SLOTS, props, report);
  return {
    sort: slot("sort"),
    display: slot("display"),
    colwidth: slot("colwidth"),
    pagesize: slot("pagesize"),
    groupFieldId: slot("groupFieldId"),
    filters: slot("filters"),
  };
}
