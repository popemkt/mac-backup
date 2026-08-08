import type { NodeMap, OutlineNode, PropValue } from "./types";
import { isSysPrefixed, SYSTEM_IDS } from "./types";

export type ViewMode = "list" | "table";
export type SortDir = "asc" | "desc";

export interface SortSpec {
  fieldId: string;
  dir: SortDir;
}

export interface ViewConfig {
  mode: ViewMode;
  sort: SortSpec[];
  display: string[];
  colwidth: Record<string, number>;
  pagesize: number;
}

export const DEFAULT_VIEW_CONFIG: ViewConfig = {
  mode: "list",
  sort: [],
  display: [],
  colwidth: {},
  pagesize: 100,
};

export function getViewConfig(
  props?: Record<string, PropValue[]>,
): ViewConfig {
  if (!props) return { ...DEFAULT_VIEW_CONFIG };

  // Mode: list | table (default: list)
  let mode: ViewMode = "list";
  const rawMode = props[SYSTEM_IDS.viewModeField]?.[0];
  if (rawMode && rawMode.t === "str" && rawMode.v === "table") {
    mode = "table";
  }

  // Sort: sys.f.view.sort (refs) + sys.f.view.sort.dir (str asc|desc)
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

  // Display: sys.f.view.display (refs)
  const displayRefs = props[SYSTEM_IDS.viewDisplayField] ?? [];
  const display: string[] = [];
  for (const ref of displayRefs) {
    if (ref.t === "ref" && !display.includes(ref.v)) {
      display.push(ref.v);
    }
  }

  // Colwidth: sys.f.view.colwidth (JSON string) — keep finite numbers > 0 only
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

  // Pagesize: sys.f.view.pagesize (num or str parsed to num)
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

  return { mode, sort, display, colwidth, pagesize };
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
    // Fallback: union of fields present on children's tags
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
      // Exclude sys.* and hidden fields unless explicitly in display or showAllFields on
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
