/**
 * Views as data: the option nodes that name views, the view node that
 * carries one, and the host that names its views.
 *
 * DESIGN.md → Kinds, roles and options → View nodes is the statement of the
 * model; this module is its vocabulary. A view's key lives with the plugin
 * that provides it (`@kb/ui`), and all the store needs of it is its name, so
 * an option's id derives from the view's id and nothing else.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";
import { childrenTargetQuery } from "./field-type.ts";

/** What this module reads of a node: its props. */
interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

/** What every view option's id starts with; the view's id follows it. */
const VIEW_OPTION_PREFIX = "sys.view.";

/** The option node that names the view `<namespace>.<local id>` in data. */
export function viewOptionId(viewId: string): string {
  return `${VIEW_OPTION_PREFIX}${viewId}`;
}

/**
 * The families of views a host chooses between by config: `sys.f.view.family`'s
 * option children, which each option node of a family carries, so a query can
 * select a family's views (the renderers a graph lists) without a list per
 * family.
 */
export const VIEW_FAMILY_VALUES = {
  "graph.renderer": { id: "sys.view-family.graph.renderer", label: "Graph renderer" },
  "outline.frame": { id: "sys.view-family.outline.frame", label: "Frame view" },
} as const;
export type ViewFamily = keyof typeof VIEW_FAMILY_VALUES;

interface ViewValue {
  readonly label: string;
  readonly family?: ViewFamily;
}

/**
 * Every view kb provides, by view id: what the seed makes one option node of,
 * under `sys.views`. The view contract holds each provided view's key to an
 * entry here with the same family, so a key and its option cannot drift.
 *
 * The seed lives here, not with each plugin, because the store is seeded on
 * open and the plugins that own these views load in the browser.
 * GAP [GAP-VIEW-OPTION-SEEDS]
 */
export const VIEW_VALUES = {
  "outline.main": { label: "Outline" },
  "outline.list": { label: "List", family: "outline.frame" },
  "outline.table": { label: "Table", family: "outline.frame" },
  "outline.board": { label: "Board", family: "outline.frame" },
  "outline.cards": { label: "Cards", family: "outline.frame" },
  "outline.snippet": { label: "Outline snippet" },
  "graph.page": { label: "Graph" },
  "graph.force2d": { label: "2D", family: "graph.renderer" },
  "graph.tree": { label: "Tree", family: "graph.renderer" },
  "graph.cluster": { label: "Cluster", family: "graph.renderer" },
  "graph.force3d": { label: "3D", family: "graph.renderer" },
  "graph.treemap": { label: "Treemap", family: "graph.renderer" },
  "graph.neighbourhood": { label: "Neighbourhood" },
  "ontology.list": { label: "Ontologies" },
  "ontology.scope": { label: "Ontology" },
  "canvas.list": { label: "Canvases" },
  "canvas.page": { label: "Canvas" },
  "lab.page": { label: "Lab" },
  "docs.markdown": { label: "Markdown document" },
} as const satisfies Readonly<Record<string, ViewValue>>;
export type ViewId = keyof typeof VIEW_VALUES;

/** Every view kb provides, as `[view id, value]` pairs in declared order. */
export function viewValueEntries(): readonly (readonly [string, ViewValue])[] {
  const values: Readonly<Record<string, ViewValue>> = VIEW_VALUES;
  return Object.entries(values);
}

/** The view an option node names, back from its id, or null for any other node. */
export function viewIdOfOption(option: NodeId): string | null {
  return option.startsWith(VIEW_OPTION_PREFIX) ? option.slice(VIEW_OPTION_PREFIX.length) : null;
}

function firstRefOf(node: Carrier | undefined, fieldId: string): NodeId | null {
  const value = node?.props[fieldId]?.find((v) => v.t === "ref");
  return value?.t === "ref" ? value.v : null;
}

/** The option a view node names (`sys.f.view`), or null when the node is no view node. */
export function viewOptionOf(node: Carrier | undefined): NodeId | null {
  return firstRefOf(node, SYSTEM_IDS.viewField);
}

/** Whether `node` is a view node: it carries `sys.f.view`, read from its carrier. */
export function isViewNode(node: Carrier | undefined): boolean {
  return viewOptionOf(node) !== null;
}

/** The view nodes a host names (`sys.f.views`), in order. */
export function hostViewIds(node: Carrier | undefined): NodeId[] {
  return (node?.props[SYSTEM_IDS.viewsField] ?? []).flatMap((v) => (v.t === "ref" ? [v.v] : []));
}

/**
 * A host's default view: the first view node its `sys.f.views` names. Order
 * is the one mechanism — making another view the default is moving it first,
 * so a default that is not among the host's views cannot be written.
 */
export function defaultViewIdOf(node: Carrier | undefined): NodeId | null {
  return hostViewIds(node)[0] ?? null;
}

/**
 * The first view node a host names whose view is of `family`, as that view's
 * option node says (`sys.f.view.family`): what the host shows through that
 * family — for a frame, the view its children are shown in — whether or not
 * it is the host's default. `lookup` reads a node by id; null when the host
 * names none.
 */
export function familyViewIdOf(
  host: Carrier | undefined,
  family: ViewFamily,
  lookup: (id: NodeId) => Carrier | undefined,
): NodeId | null {
  const familyId = VIEW_FAMILY_VALUES[family].id;
  const inFamily = (id: NodeId): boolean => {
    const option = viewOptionOf(lookup(id));
    return option !== null && firstRefOf(lookup(option), SYSTEM_IDS.viewFamilyField) === familyId;
  };
  return hostViewIds(host).find(inFamily) ?? null;
}

/**
 * A docs view (`docs.markdown`): the rows of its subject query rendered
 * through a template an extension registers, written to a repo path. It is a
 * view node like any other; the server's render layer draws it.
 */
export type DocsViewSpec = {
  readonly template: string;
  /** Repo-relative markdown path. */
  readonly output: string;
} & (
  | {
      /** Parameter-free EDN datalog whose rows the template renders (`lens.query`). */
      readonly query: string;
      readonly savedQuery?: undefined;
    }
  | {
      /** A saved query's name, resolved when the view renders (`sys.f.view.saved-query`). */
      readonly savedQuery: string;
      readonly query?: undefined;
    }
);

/** The option a docs view node names. */
export const DOCS_VIEW_OPTION = viewOptionId("docs.markdown");

const str = (v: string): PropValue[] => [{ t: "str", v }];

/** A docs view node's props for `spec`: its view, then its params. */
export function docsViewProps(spec: DocsViewSpec): Record<string, PropValue[]> {
  return {
    [SYSTEM_IDS.viewField]: [{ t: "ref", v: DOCS_VIEW_OPTION }],
    ...(spec.query === undefined
      ? { [SYSTEM_IDS.viewSavedQueryField]: str(spec.savedQuery) }
      : { [SYSTEM_IDS.lensQueryField]: str(spec.query) }),
    [SYSTEM_IDS.viewTemplateField]: str(spec.template),
    [SYSTEM_IDS.viewOutputField]: str(spec.output),
  };
}

/** What `sys.f.view` may name: the option children of `sys.views`. */
export const VIEW_OPTION_TARGET_QUERY = childrenTargetQuery(SYSTEM_IDS.viewsRoot);

/** What `sys.f.views` may name: every view node, the carrier of `sys.f.view`. */
export const VIEW_NODE_TARGET_QUERY = `[:find ?id :where [?n :f/${SYSTEM_IDS.viewField} ?o] [?n :node/id ?id]]`;

/** The options of one family: `sys.views`' children carrying that family. */
export function viewFamilyTargetQuery(family: ViewFamily): string {
  return [
    "[:find ?id :where",
    `[?p :node/id "${SYSTEM_IDS.viewsRoot}"]`,
    "[?p :node/child ?c]",
    "[?p :node/child-order ?o]",
    "[?c :node/id ?id]",
    `[?c :f/${SYSTEM_IDS.viewFamilyField} ?f]`,
    `[?f :node/id "${VIEW_FAMILY_VALUES[family].id}"]]`,
  ].join(" ");
}

/**
 * The view nodes whose view is in `family`: what a family's listing is (the
 * graphs a sidebar offers are the view nodes whose view is a renderer).
 */
export function familyViewNodesQuery(family: ViewFamily): string {
  return [
    "[:find ?id :where",
    `[?n :f/${SYSTEM_IDS.viewField} ?o]`,
    `[?o :f/${SYSTEM_IDS.viewFamilyField} ?f]`,
    `[?f :node/id "${VIEW_FAMILY_VALUES[family].id}"]`,
    "[?n :node/id ?id]]",
  ].join(" ");
}
