import type { NodeMap, OutlineNode, PropValue } from "./types";
import { isSysPrefixed, SYSTEM_IDS } from "./types";

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

const VIEW_MODES = new Set<ViewMode>(["list", "table", "board", "cards"]);

/** Serialize a filter back to the EDN string stored on the frame. */
export function serializeViewFilter(
  filter: Exclude<ViewFilter, never> & { raw?: string },
): string {
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

  const textMatch = raw.match(/^\{:text\s+"((?:\\.|[^"\\])*)"\s*\}$/);
  if (textMatch) {
    return {
      kind: "text",
      text: textMatch[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
      raw,
    };
  }

  // {:field <id> :eq "value"} | {:field <id> :eq bare}
  const eqMatch = raw.match(
    /^\{:field\s+(\S+)\s+:eq\s+(?:"((?:\\.|[^"\\])*)"|(\S+))\s*\}$/,
  );
  if (eqMatch) {
    const fieldId = eqMatch[1]!;
    const quoted = eqMatch[2];
    const bare = eqMatch[3];
    const value =
      quoted !== undefined
        ? quoted.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        : bare!.replace(/^:/, "");
    return { kind: "eq", fieldId, value, raw };
  }

  return null;
}

function propValueKey(v: PropValue, nodes: NodeMap): string {
  if (v.t === "ref") return `ref:${v.v}`;
  if (v.t === "bool") return `bool:${v.v ? 1 : 0}`;
  if (v.t === "num") return `num:${v.v}`;
  return `str:${String(v.v)}`;
}

function propValueLabel(v: PropValue, nodes: NodeMap): string {
  if (v.t === "ref") return nodes.get(v.v)?.text || v.v;
  if (v.t === "bool") return v.v ? "true" : "false";
  return String(v.v);
}

function matchesFilter(
  node: OutlineNode,
  filter: ViewFilter,
  nodes: NodeMap,
): boolean {
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
  return children.filter((n) =>
    filters.every((f) => matchesFilter(n, f, nodes)),
  );
}

export function getViewConfig(
  props?: Record<string, PropValue[]>,
): ViewConfig {
  if (!props) return { ...DEFAULT_VIEW_CONFIG };

  let mode: ViewMode = "list";
  const rawMode = props[SYSTEM_IDS.viewModeField]?.[0];
  if (rawMode && rawMode.t === "str" && VIEW_MODES.has(rawMode.v as ViewMode)) {
    mode = rawMode.v as ViewMode;
  }

  const sortRefs = props[SYSTEM_IDS.viewSortField] ?? [];
  const sortDirs = props[SYSTEM_IDS.viewSortDirField] ?? [];
  const sort: SortSpec[] = [];
  for (let i = 0; i < sortRefs.length; i++) {
    const ref = sortRefs[i];
    if (ref && ref.t === "ref") {
      const dirVal = sortDirs[i];
      const dir: SortDir =
        dirVal && dirVal.t === "str" && dirVal.v === "desc" ? "desc" : "asc";
      sort.push({ fieldId: ref.v, dir });
    }
  }

  const displayRefs = props[SYSTEM_IDS.viewDisplayField] ?? [];
  const display: string[] = [];
  for (const ref of displayRefs) {
    if (ref.t === "ref" && !display.includes(ref.v)) {
      display.push(ref.v);
    }
  }

  let colwidth: Record<string, number> = {};
  const rawColwidth = props[SYSTEM_IDS.viewColwidthField]?.[0];
  if (rawColwidth && rawColwidth.t === "str") {
    try {
      const parsed = JSON.parse(rawColwidth.v);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        for (const [key, value] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            colwidth[key] = value;
          }
        }
      }
    } catch {
      colwidth = {};
    }
  }

  let pagesize = 100;
  const rawPagesize = props[SYSTEM_IDS.viewPagesizeField]?.[0];
  if (rawPagesize) {
    if (
      rawPagesize.t === "num" &&
      typeof rawPagesize.v === "number" &&
      rawPagesize.v > 0
    ) {
      pagesize = rawPagesize.v;
    } else if (rawPagesize.t === "str") {
      const num = parseInt(rawPagesize.v, 10);
      if (!isNaN(num) && num > 0) pagesize = num;
    }
  }

  let groupFieldId: string | null = null;
  const rawGroup = props[SYSTEM_IDS.viewGroupField]?.[0];
  if (rawGroup && rawGroup.t === "ref" && rawGroup.v) {
    groupFieldId = rawGroup.v;
  }

  const filters: ViewFilter[] = [];
  for (const raw of props[SYSTEM_IDS.viewFilterField] ?? []) {
    if (raw.t !== "str") continue;
    const parsed = parseViewFilterEdn(raw.v);
    if (parsed) {
      filters.push(parsed);
    } else {
      console.warn(`[view-config] ignoring bad filter EDN: ${raw.v}`);
    }
  }

  return { mode, sort, display, colwidth, pagesize, groupFieldId, filters };
}

export interface TableColumnSpec {
  fieldId: string;
  label: string;
}

export function resolveTableColumns(
  viewConfig: ViewConfig,
  children: OutlineNode[],
  nodes: NodeMap,
  showAllFields = false,
): TableColumnSpec[] {
  let candidateFieldIds: string[] = [];

  if (viewConfig.display.length > 0) {
    candidateFieldIds = [...viewConfig.display];
  } else {
    const seen = new Set<string>();
    for (const child of children) {
      for (const tag of child.tags) {
        const tagNode = nodes.get(tag.id);
        if (!tagNode) continue;
        const fields = tagNode.props[SYSTEM_IDS.fieldsField] ?? [];
        for (const ref of fields) {
          if (ref.t === "ref" && !seen.has(ref.v)) {
            seen.add(ref.v);
            candidateFieldIds.push(ref.v);
          }
        }
      }
    }
  }

  const columns: TableColumnSpec[] = [];
  for (const fieldId of candidateFieldIds) {
    if (!showAllFields) {
      const isHidden =
        nodes.get(fieldId)?.props[SYSTEM_IDS.hiddenField]?.[0]?.v === true;
      if (viewConfig.display.length === 0) {
        if (isSysPrefixed(fieldId) || isHidden) continue;
      } else {
        if (isHidden) continue;
      }
    }
    const fieldNode = nodes.get(fieldId);
    const label = fieldNode?.text || fieldId;
    columns.push({ fieldId, label });
  }

  return columns;
}

export function sortChildrenForTable(
  children: OutlineNode[],
  sortSpecs: SortSpec[],
  nodes: NodeMap,
): OutlineNode[] {
  if (sortSpecs.length === 0) return children;

  const sorted = [...children];
  sorted.sort((a, b) => {
    for (const spec of sortSpecs) {
      const { fieldId, dir } = spec;
      let cmp = 0;

      if (fieldId === "__name__") {
        const textA = a.text.toLowerCase();
        const textB = b.text.toLowerCase();
        cmp = textA < textB ? -1 : textA > textB ? 1 : 0;
      } else {
        const valA = a.props[fieldId]?.[0];
        const valB = b.props[fieldId]?.[0];

        if (!valA && !valB) {
          cmp = 0;
        } else if (!valA) {
          cmp = 1;
        } else if (!valB) {
          cmp = -1;
        } else if (valA.t === "num" && valB.t === "num") {
          cmp = valA.v - valB.v;
        } else if (valA.t === "bool" && valB.t === "bool") {
          cmp = (valA.v ? 1 : 0) - (valB.v ? 1 : 0);
        } else if (valA.t === "ref" && valB.t === "ref") {
          const textA = (nodes.get(valA.v)?.text || valA.v).toLowerCase();
          const textB = (nodes.get(valB.v)?.text || valB.v).toLowerCase();
          cmp = textA < textB ? -1 : textA > textB ? 1 : 0;
        } else {
          const strA = String(valA.v).toLowerCase();
          const strB = String(valB.v).toLowerCase();
          cmp = strA < strB ? -1 : strA > strB ? 1 : 0;
        }
      }

      if (cmp !== 0) {
        return dir === "asc" ? cmp : -cmp;
      }
    }
    return 0;
  });

  return sorted;
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
  if (!groupFieldId) {
    return [
      {
        key: "__all__",
        label: "",
        value: null,
        nodes: [...children],
      },
    ];
  }

  const fieldLabel = nodes.get(groupFieldId)?.text || groupFieldId;
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
    // Multi-value: card appears in first value's column (Tana-ish).
    const v = vals[0]!;
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

  const ordered = [...columns.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  ordered.push(empty);
  return ordered;
}

/** Flatten board columns to render-order node list (visible-instances). */
export function flattenBoardOrder(
  columns: BoardColumn[],
): OutlineNode[] {
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
