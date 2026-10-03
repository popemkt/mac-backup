/**
 * The layout view type (roadmap decision 12): panes arranged as splits and
 * tabs. A dashboard is a layout view open inside one pane; the workspace is a
 * layout open as the whole screen. Both are this one tree, and only the
 * chrome around it differs. DESIGN.md → Kinds, roles and options → Layout
 * views states the model; this module is its vocabulary and its pure edits.
 */
import { Result, Schema } from "effect";
import { SYSTEM_IDS, canonicalJson, firstRef, firstStr } from "@kb/model";
import { encodeLensConfig } from "./lens.ts";
import { issueText, paramsIssues, viewKey, type ConfigReport } from "./view-key.ts";

/** The layout plugin's namespace and view keys: what a host imports, never the components. */
export const LAYOUT_NAMESPACE = "layout";

/** A pane's id: unique in its layout, and never holding a `/` (it keys rows and paths). */
const PaneId = Schema.NonEmptyString.check(
  Schema.makeFilter((id: string) => !id.includes("/"), { expected: "a pane id without /" }),
);

/** A kb location: a path the UI's route table resolves (`/node/<id>`, `/graph/<id>`, `/`). */
const KbPath = Schema.String.check(
  Schema.makeFilter((path: string) => path.startsWith("/"), { expected: "a path starting at /" }),
);

/**
 * One pane: what it shows, as a kb location. `/node/<id>` shows a node in its
 * default view, `/node/<id>/<view>` shows it through one of its view nodes
 * (or a view type, by its option), and any other path a kb page owns shows
 * that page.
 */
// A pane names where it is, never another pane: a view that follows another
// pane's focused node has nothing to bind to yet. GAP [[01M411FQ0FQMXK01FCB1840GT0]]
export const LayoutPane = Schema.Struct({ id: PaneId, path: KbPath });
export type LayoutPane = typeof LayoutPane.Type;

/** Panes stacked as tabs, one of them showing (`active`, by default the first). */
export const LayoutTabs = Schema.Struct({
  tabs: Schema.NonEmptyArray(LayoutPane),
  active: Schema.optionalKey(PaneId),
}).check(
  Schema.makeFilter(
    (group: { readonly tabs: readonly LayoutPane[]; readonly active?: string }) =>
      group.active === undefined ||
      group.tabs.some((pane) => pane.id === group.active) ||
      `active names no tab: ${group.active}`,
  ),
);
export type LayoutTabs = typeof LayoutTabs.Type;

/** Which way a split lays its children out: side by side, or one above another. */
export const SPLIT_DIRECTIONS = ["row", "column"] as const;
export type SplitDirection = (typeof SPLIT_DIRECTIONS)[number];

export interface LayoutSplit {
  readonly split: SplitDirection;
  readonly children: readonly LayoutTree[];
  /** Each child's share of the split, as fractions summing to 1; equal when absent. */
  readonly sizes?: readonly number[];
}

/** A layout: tabs, or a split of layouts. */
export type LayoutTree = LayoutTabs | LayoutSplit;

const Fraction = Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThan(1));

const sizesFit = (split: LayoutSplit): true | string => {
  if (split.sizes === undefined) return true;
  if (split.sizes.length !== split.children.length)
    return `sizes has ${split.sizes.length} entries for ${split.children.length} children`;
  const sum = split.sizes.reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1) <= 0.001 || `sizes sum to ${sum}, not 1`;
};

const runsAcross = (split: LayoutSplit): true | string =>
  split.children.every((child) => !("split" in child) || child.split !== split.split) ||
  `a split inside a ${split.split} runs across it, so it cannot be a ${split.split} too`;

const LayoutSplitSchema: Schema.Codec<LayoutSplit> = Schema.Struct({
  split: Schema.Literals(SPLIT_DIRECTIONS),
  children: Schema.Array(Schema.suspend((): Schema.Codec<LayoutTree> => LayoutTreeSchema)).check(
    Schema.isMinLength(2),
  ),
  sizes: Schema.optionalKey(Schema.Array(Fraction)),
})
  .check(Schema.makeFilter(sizesFit), Schema.makeFilter(runsAcross))
  .annotate({ identifier: "LayoutSplit" });

const LayoutTreeSchema: Schema.Codec<LayoutTree> = Schema.Union([
  LayoutTabs,
  LayoutSplitSchema,
]).annotate({ identifier: "LayoutTree" });

/** Every pane in `tree`, in reading order (left to right, top to bottom, tab by tab). */
export function layoutPanes(tree: LayoutTree): readonly LayoutPane[] {
  return "tabs" in tree ? tree.tabs : tree.children.flatMap(layoutPanes);
}

const uniquePanes = (params: { readonly root: LayoutTree }): true | string => {
  const seen = new Set<string>();
  for (const pane of layoutPanes(params.root)) {
    if (seen.has(pane.id)) return `pane id ${pane.id} is used twice`;
    seen.add(pane.id);
  }
  return true;
};

export const LayoutParams = Schema.Struct({ root: LayoutTreeSchema })
  .annotate({
    description:
      "Panes arranged as splits and tabs. root is either tabs ({tabs: [pane, …], active?: pane id}) or a split ({split: row | column, children: [≥2 layouts], sizes?: fractions summing to 1}); a split inside a row is a column and the other way round. A pane is {id, path}: its id is unique in the layout, and its path is the kb location it shows — /node/<id> a node in its default view, /node/<id>/<view node or view option id> that node through one view, or any other kb page path (/graph/<id>, /canvas/<id>, /). Shown inside a pane it is a dashboard, whose arrangement is fixed; opened as the workspace, its panes can be moved.",
  })
  .check(Schema.makeFilter(uniquePanes));
export type LayoutParams = typeof LayoutParams.Type;

/** The arrangement as one prop: its canonical JSON, the one string a layout reads back. */
function readArrangement(raw: string | undefined, report: ConfigReport): unknown {
  if (raw === undefined || raw === "") return {};
  try {
    return { root: JSON.parse(raw) as unknown };
  } catch {
    report(`${SYSTEM_IDS.layoutField} is not JSON`);
    return {};
  }
}

/**
 * A layout view: a view node naming `layout.grid`, whose arrangement is one
 * text prop (`sys.f.layout`) holding the tree as canonical JSON — the shape a
 * canvas keeps its layout in, so a drag writes one prop atomically. The nodes
 * its panes open live inside that JSON, so the loader derives no mention of
 * them and they have no backlink to the layout. GAP [[01M411FNY9J46BD71N2C5641NB]]
 */
export const LayoutView = viewKey(`${LAYOUT_NAMESPACE}.grid`, LayoutParams, {
  read: (props, _host, report) => readArrangement(firstStr(SYSTEM_IDS.layoutField)(props), report),
  write: ({ root }) => ({ [SYSTEM_IDS.layoutField]: [{ t: "str", v: canonicalJson(root) }] }),
});

/**
 * A node, shown in its default view, or through one view (`view`: a view node
 * the node names, or a view type by its option). It is the view `/node/<id>`
 * opens: the one route a node is opened by, wherever it is opened from.
 */
export const NodeParams = Schema.Struct({
  node: Schema.NonEmptyString,
  view: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({
  description:
    "A node shown in its default view (the first view node it names, or its outline when it names none), or through view: one of its view nodes, or a view type by its option. Stored, node is lens.focus, else the node it is shown for.",
});
export type NodeParams = typeof NodeParams.Type;

export const NodeView = viewKey(`${LAYOUT_NAMESPACE}.node`, NodeParams, {
  read: (props, host) => {
    const node = firstRef(SYSTEM_IDS.lensFocusField)(props) ?? host ?? undefined;
    return node === undefined ? {} : { node };
  },
  write: ({ node }) => encodeLensConfig({ focus: node }),
});

// ── the tree's edits: pure, each returning a layout the schema accepts ────

/** One pane on its own: a workspace before anything is opened beside it. */
export function singlePane(pane: LayoutPane): LayoutTree {
  return { tabs: [pane] };
}

/** The pane `id` in `tree`, if any. */
export function findPane(tree: LayoutTree, id: string): LayoutPane | undefined {
  return layoutPanes(tree).find((pane) => pane.id === id);
}

/** The first `p<n>` no pane of `tree` holds. */
export function freshPaneId(tree: LayoutTree): string {
  const taken = new Set(layoutPanes(tree).map((pane) => pane.id));
  let n = 2;
  while (taken.has(`p${n}`)) n += 1;
  return `p${n}`;
}

function mapPanes(tree: LayoutTree, f: (pane: LayoutPane) => LayoutPane): LayoutTree {
  if ("tabs" in tree) {
    const [first, ...rest] = tree.tabs;
    return { ...tree, tabs: [f(first), ...rest.map(f)] };
  }
  return { ...tree, children: tree.children.map((child) => mapPanes(child, f)) };
}

/** `tree` with pane `id` showing `path`. */
export function withPanePath(tree: LayoutTree, id: string, path: string): LayoutTree {
  return mapPanes(tree, (pane) =>
    pane.id === id && pane.path !== path ? { ...pane, path } : pane,
  );
}

function contains(tree: LayoutTree, id: string): boolean {
  return findPane(tree, id) !== undefined;
}

/**
 * `tree` with `pane` opened beside `anchor`, to its right (Tana's panels):
 * a new column after the column that holds `anchor`, in a row at the top.
 */
export function openBeside(tree: LayoutTree, anchor: string, pane: LayoutPane): LayoutTree {
  const column = singlePane(pane);
  if (!("split" in tree) || tree.split !== "row") return { split: "row", children: [tree, column] };
  const at = tree.children.findIndex((child) => contains(child, anchor));
  const children = [...tree.children];
  children.splice(at < 0 ? children.length : at + 1, 0, column);
  return { split: "row", children };
}

/**
 * `tree` as the schema states it: a split with one child is that child, a
 * split inside a split of its own direction gives its children to it, and
 * sizes that no longer fit their children are dropped.
 */
export function normalizeLayout(tree: LayoutTree): LayoutTree {
  if ("tabs" in tree) return tree;
  const children = tree.children
    .map(normalizeLayout)
    .flatMap((child): readonly LayoutTree[] =>
      "split" in child && child.split === tree.split ? child.children : [child],
    );
  const [only] = children;
  if (only !== undefined && children.length === 1) return only;
  const flattened = children.length !== tree.children.length;
  return flattened || tree.sizes === undefined
    ? { split: tree.split, children }
    : { split: tree.split, children, sizes: tree.sizes };
}

function withoutPane(tree: LayoutTree, id: string): LayoutTree | null {
  if ("tabs" in tree) {
    const kept = tree.tabs.filter((pane) => pane.id !== id);
    if (kept.length === tree.tabs.length) return tree;
    const [first, ...rest] = kept;
    if (first === undefined) return null;
    const active = tree.active === id ? undefined : tree.active;
    return active === undefined ? { tabs: [first, ...rest] } : { tabs: [first, ...rest], active };
  }
  const children = tree.children.flatMap((child) => {
    const kept = withoutPane(child, id);
    return kept === null ? [] : [kept];
  });
  const [only] = children;
  if (only === undefined) return null;
  if (children.length === 1) return only;
  return children.length === tree.children.length && tree.sizes !== undefined
    ? { split: tree.split, children, sizes: tree.sizes }
    : { split: tree.split, children };
}

/** `tree` without pane `id`; the last pane is never closed, so `tree` comes back unchanged then. */
export function closePane(tree: LayoutTree, id: string): LayoutTree {
  if (layoutPanes(tree).length <= 1) return tree;
  return normalizeLayout(withoutPane(tree, id) ?? tree);
}

/** The pane to focus once `id` closes: the one before it, else the one after. */
export function neighbourOf(tree: LayoutTree, id: string): string | null {
  const panes = layoutPanes(tree);
  const at = panes.findIndex((pane) => pane.id === id);
  return (panes[at - 1] ?? panes[at + 1])?.id ?? null;
}

/** `input` as a layout the schema accepts, or every reason it is not one. */
export function decodeLayout(input: unknown): Result.Result<LayoutTree, string> {
  return Result.mapBoth(paramsIssues(LayoutView, { root: input }, true), {
    onSuccess: (params) => params.root,
    onFailure: (issues) => issues.map(issueText).join("; "),
  });
}

/** Whether two layouts are the same arrangement. */
export function sameLayout(a: LayoutTree, b: LayoutTree): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
