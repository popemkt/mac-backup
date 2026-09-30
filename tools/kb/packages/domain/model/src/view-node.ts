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
import { GRAPH_RENDERER_VALUES } from "./graph-schema.ts";

/** What this module reads of a node: its props. */
interface Carrier {
  readonly props: Readonly<Record<string, readonly PropValue[]>>;
}

/** The option node that names the view `<namespace>.<local id>` in data. */
export function viewOptionId(viewId: string): string {
  return `sys.view.${viewId}`;
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
export const VIEW_VALUES: Readonly<Record<string, ViewValue>> = {
  "outline.main": { label: "Outline" },
  "outline.list": { label: "List", family: "outline.frame" },
  "outline.table": { label: "Table", family: "outline.frame" },
  "outline.board": { label: "Board", family: "outline.frame" },
  "outline.cards": { label: "Cards", family: "outline.frame" },
  "outline.snippet": { label: "Outline snippet" },
  "graph.page": { label: "Graph" },
  "graph.force2d": { label: GRAPH_RENDERER_VALUES.force2d.label, family: "graph.renderer" },
  "graph.tree": { label: GRAPH_RENDERER_VALUES.tree.label, family: "graph.renderer" },
  "graph.cluster": { label: GRAPH_RENDERER_VALUES.cluster.label, family: "graph.renderer" },
  "graph.force3d": { label: GRAPH_RENDERER_VALUES.force3d.label, family: "graph.renderer" },
  "graph.treemap": { label: GRAPH_RENDERER_VALUES.treemap.label, family: "graph.renderer" },
  "graph.neighbourhood": { label: "Neighbourhood" },
  "ontology.list": { label: "Ontologies" },
  "ontology.scope": { label: "Ontology" },
  "canvas.list": { label: "Canvases" },
  "canvas.page": { label: "Canvas" },
  "lab.page": { label: "Lab" },
};

/**
 * Where a view node asks to be shown for its host: `sys.f.view.placement`'s
 * option children. `card` and `hover` are the host's to set, never stored.
 */
export const VIEW_PLACEMENT_VALUES = {
  inline: { id: "sys.view-placement.inline", label: "Inline" },
  beside: { id: "sys.view-placement.beside", label: "Beside" },
  float: { id: "sys.view-placement.float", label: "Float" },
} as const;
export type StoredPlacement = keyof typeof VIEW_PLACEMENT_VALUES;
/** Declared order, which becomes the order the placement picker offers. */
export const STORED_PLACEMENTS: readonly StoredPlacement[] = ["inline", "beside", "float"];

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

/** The placement a view node asks for (`sys.f.view.placement`), or null when it asks none. */
export function storedPlacementOf(node: Carrier | undefined): StoredPlacement | null {
  const option = firstRefOf(node, SYSTEM_IDS.viewPlacementField);
  return (
    STORED_PLACEMENTS.find((placement) => VIEW_PLACEMENT_VALUES[placement].id === option) ?? null
  );
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
