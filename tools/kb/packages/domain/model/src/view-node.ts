/**
 * Views as data: the option nodes that name views, the view node that
 * carries one, and the host that names its views.
 *
 * DESIGN.md → Kinds, roles and options → View nodes is the statement of the
 * model; this module is its vocabulary. A view's key lives in `@kb/views`,
 * which builds on this package, and all the store needs of it is its name, so
 * an option's id derives from the view's id and nothing else.
 */
import { SYSTEM_IDS, type NodeId, type PropValue } from "./model.ts";
import { childrenTargetQuery } from "./field-type.ts";
import { isValidWorkspaceName } from "./workspace-name.ts";

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
 * A host's views with `viewId` first and the rest in their order: what
 * making it the host's default writes, as one replacement of `sys.f.views`.
 */
export function viewsWithDefault(node: Carrier | undefined, viewId: NodeId): NodeId[] {
  return [viewId, ...hostViewIds(node).filter((id) => id !== viewId)];
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

/** Whether `node` is a docs view: a view node whose view is `docs.markdown`. */
export function isDocsView(node: Carrier | undefined): boolean {
  return viewOptionOf(node) === DOCS_VIEW_OPTION;
}

/** A node as a docs view's name is read from it: its id, text and props. */
interface NamedCarrier extends Carrier {
  readonly id: NodeId;
  readonly text: string;
}

/** The name a docs view goes by: its text, trimmed. */
export function docsViewNameOf(node: { readonly text: string }): string {
  return node.text.trim();
}

/**
 * Why a docs view's name cannot name it among `nodes` (the whole graph), or
 * null. The name is what `render.view`, `docs.materialize`/`docs.check` and
 * `ui://kb/view/<name>` address it by, so it is a workspace name
 * (`isValidWorkspaceName`) and no other docs view goes by it. The write check
 * refuses a docs view that breaks this; `docs.check` reports one already
 * stored.
 */
export function docsViewNameError(
  node: NamedCarrier,
  nodes: Iterable<NamedCarrier>,
): string | null {
  const name = docsViewNameOf(node);
  if (!isValidWorkspaceName(name))
    return `docs view name "${name}" is not a workspace name (letters, digits, _ . -, starting on a letter, digit or _)`;
  for (const other of nodes)
    if (other.id !== node.id && isDocsView(other) && docsViewNameOf(other) === name)
      return `docs view name ${name} is taken by ${other.id}`;
  return null;
}

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
