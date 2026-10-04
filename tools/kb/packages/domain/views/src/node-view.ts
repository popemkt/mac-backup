/**
 * What `/node/<id>[/<view>]` shows: a node in its default view, or through
 * one view. One function, so the UI's own links, a pane, a layout's panes and
 * `ui.navigate` open a node the same way. DESIGN.md → Kinds, roles and
 * options → Layout views states the rule.
 */
import { Result } from "effect";
import {
  defaultViewIdOf,
  isViewNode,
  viewIdOfOption,
  viewOptionId,
  viewOptionOf,
  type NodeId,
  type NodeProps,
} from "@kb/model";
import type { CatalogItem, ViewCatalogEntry, ViewCatalogOf } from "./catalog.ts";
import { FRAME_VIEW_FAMILY } from "./frame.ts";
import { GraphView } from "./graph.ts";
import { OutlineView } from "./outline.ts";
import type { NodeParams } from "./layout.ts";
import type { ConfigReport, ViewKey } from "./view-key.ts";

/** What the resolver reads of a node: its props, and its text when it names a view. */
interface Carrier {
  readonly props: NodeProps;
  readonly text?: string;
}

/**
 * The view a node opens in: its key, the input its params decode from, and
 * the subject the slot shows it for (the view node, or the node).
 */
export interface HeldViewTarget {
  readonly key: ViewKey<unknown>;
  readonly input: unknown;
  readonly subject: NodeId;
  /** The view node it shows, when it shows one (not a view type, not the outline). */
  readonly viewNode?: NodeId;
}

/** A view as a host names one it cannot draw: its id and its label. */
export type NamedView = Pick<ViewCatalogEntry, "id" | "label">;

/**
 * A view the host holds no key for: one its catalog lists without a key (the
 * page, for a view no loaded plugin draws), or one of a family the host has
 * switched off, which no catalog lists. Named ({@link viewNamed}), so a host
 * can say which view it cannot show here.
 */
export interface UnheldViewTarget {
  readonly key: null;
  readonly listed: NamedView;
  readonly subject: NodeId;
  readonly viewNode?: NodeId;
}

export type NodeViewTarget = HeldViewTarget | UnheldViewTarget;

type Catalog = Pick<ViewCatalogOf<CatalogItem>, "keyOf" | "listedOf">;

/**
 * The page a view of `key` is shown on, shown for `host` through view node
 * `viewNode`: a frame view lays out a frame's rows inside the outline, so its
 * page is the outline at the frame; a graph renderer draws inside the graph
 * page, so its page is the graph page drawing that view node. Any other view
 * is its own page.
 */
function pageOf(
  key: ViewKey<unknown>,
  props: NodeProps,
  host: NodeId | null,
  viewNode: NodeId | null,
  report: ConfigReport,
): { readonly key: ViewKey<unknown>; readonly input: unknown } {
  // The outline lays the frame out through the frame's own first frame view,
  // so another of its frame view nodes chosen here shows that one instead.
  // GAP [[01M411FPKHWPRFTWDYKVXBDYSB]]
  if (key.family === FRAME_VIEW_FAMILY && host !== null)
    return { key: OutlineView, input: { root: host } };
  if (key.family === "graph.renderer" && viewNode !== null)
    return { key: GraphView, input: { perspective: viewNode } };
  return { key, input: key.config.read(props, host, report) };
}

/**
 * What `params` opens, reading nodes through `lookup` and naming views
 * through `catalog`, the host's view catalog:
 *
 * - `view` names a view type (its option): that view, with the settings a
 *   view node holding none reads as, shown for the node;
 * - `view` names a view node: that view node, shown for the node;
 * - no `view`, and the node is a view node: that view node, shown for no node;
 * - no `view`: the node's default view (the first view node it names), or,
 *   when it names none, the outline at the node.
 *
 * A view the host holds no key for resolves to its name (`key: null`,
 * {@link viewNamed}), not to a failure: the node is there, and its view is
 * one this host cannot draw, because no plugin here draws it or its family
 * is switched off.
 */
export function resolveNodeView(
  params: NodeParams,
  catalog: Catalog,
  lookup: (id: NodeId) => Carrier | undefined,
  report: ConfigReport,
): Result.Result<NodeViewTarget, string> {
  const node = lookup(params.node);
  if (node === undefined) return Result.fail(`no node ${params.node}`);
  const type = params.view === undefined ? null : viewIdOfOption(params.view);
  if (type !== null) {
    const key = catalog.keyOf(type);
    if (key === null)
      return unheld(catalog, lookup, type, { subject: params.node }, `no view ${type}`);
    return Result.succeed({ ...pageOf(key, {}, params.node, null, report), subject: params.node });
  }
  const self = params.view === undefined && isViewNode(node);
  const viewId = params.view ?? (self ? params.node : defaultViewIdOf(node));
  if (viewId === null)
    return Result.succeed({ key: OutlineView, input: { root: params.node }, subject: params.node });
  const view = lookup(viewId);
  const option = viewOptionOf(view);
  const key = option === null ? null : catalog.keyOf(option);
  const missing = `${viewId} is no view node`;
  if (view === undefined || option === null) return Result.fail(missing);
  if (key === null)
    return unheld(catalog, lookup, option, { subject: viewId, viewNode: viewId }, missing);
  const host = self ? null : params.node;
  return Result.succeed({
    ...pageOf(key, view.props, host, viewId, report),
    subject: viewId,
    viewNode: viewId,
  });
}

/**
 * The view `view` (its id or its option) names: as `catalog` lists it, else
 * as the graph holds its option node. A view of a family switched off is
 * listed by no catalog, but its option is seeded whatever loads (the seed is
 * the bundled fold), and the option's text is the view's label. Null for
 * neither, so a name that is no view stays one.
 */
export function viewNamed(
  view: string,
  catalog: Pick<Catalog, "listedOf">,
  lookup: (id: NodeId) => Carrier | undefined,
): NamedView | null {
  const listed = catalog.listedOf(view);
  if (listed !== null) return listed;
  const id = viewIdOfOption(view) ?? view;
  const label = lookup(viewOptionId(id))?.text;
  return label === undefined ? null : { id, label };
}

/** The view `view` names, held by no key ({@link viewNamed}), else `failure`. */
function unheld(
  catalog: Catalog,
  lookup: (id: NodeId) => Carrier | undefined,
  view: string,
  shown: { readonly subject: NodeId; readonly viewNode?: NodeId },
  failure: string,
): Result.Result<UnheldViewTarget, string> {
  const listed = viewNamed(view, catalog, lookup);
  return listed === null ? Result.fail(failure) : Result.succeed({ key: null, listed, ...shown });
}
