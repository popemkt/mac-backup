/**
 * The bundled fold (DESIGN.md → Extension families → the seed is the bundled
 * fold): every declaration's seed nodes, the node each declaration derives
 * under `sys.extensions`, the option node each declared view derives under
 * `sys.views`, and the default view type its one provider declares, folded
 * into the seed a store is opened with.
 */
import { SYSTEM_IDS, extensionNodeId, type KbNode, nowIso } from "./model.ts";
import { VIEW_FAMILY_VALUES, viewOptionId, type ViewFamily } from "./view-node.ts";

/**
 * A view as the seed names it: its id, the label its option node carries,
 * and the family it is one of. A view's key is one, so the option is derived
 * from the key and never declared a second time.
 */
export interface SeedView {
  readonly id: string;
  readonly label: string;
  readonly family?: ViewFamily | undefined;
}

/**
 * What one declaration gives the seed (DESIGN.md → Extension families → the
 * seed is the bundled fold): its own system nodes under frozen ids, the
 * views whose option nodes the fold derives, and, from at most one source,
 * which of those views a node that names no view opens in.
 */
export interface SeedSource {
  readonly name: string;
  /** What its own node (`extensionNodeId(name)`) is called. */
  readonly label: string;
  readonly seed?: (at: string) => readonly KbNode[];
  readonly views?: readonly { readonly key: SeedView }[];
  /**
   * The view type a node that names no view opens in: one of this source's
   * own `views`, by its key, so it selects from the list and names nothing
   * else. The fold writes it as `sys.views`' `sys.f.view.default`.
   */
  readonly defaultView?: SeedView;
}

/**
 * The default view type the sources provide, as `sys.views`' prop: the one
 * source's `defaultView`, which must be one of its own views. Two sources
 * that each provide one, or one that names a view it does not provide, is a
 * bundling defect, so it throws. With none, `sys.views` names no default and
 * a node that names no view opens as broken (DESIGN.md → View nodes).
 */
function defaultViewProps(sources: readonly SeedSource[]): KbNode["props"] {
  const providers = sources.filter((source) => source.defaultView !== undefined);
  const [provider, second] = providers;
  if (second !== undefined) {
    throw new Error(
      `the default view type is provided twice (${providers.map((p) => p.name).join(", ")})`,
    );
  }
  const view = provider?.defaultView;
  if (provider === undefined || view === undefined) return {};
  if (!(provider.views ?? []).some(({ key }) => key.id === view.id)) {
    throw new Error(`${provider.name} names ${view.id} its default view but provides no such view`);
  }
  return { [SYSTEM_IDS.viewDefaultField]: [{ t: "ref", v: viewOptionId(view.id) }] };
}

/** The option node that names `view` under `sys.views`, carrying its family. */
function viewOptionNode(view: SeedView, at: string): KbNode {
  return {
    id: viewOptionId(view.id),
    text: view.label,
    props:
      view.family === undefined
        ? {}
        : { [SYSTEM_IDS.viewFamilyField]: [{ t: "ref", v: VIEW_FAMILY_VALUES[view.family].id }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * A source's own node, `sys.extension.<name>`, as the fold derives it: named
 * by its label and holding nothing, so an optional family's switch reads as
 * its declared default until someone switches it. Being one of
 * `sys.extensions`' children is what it is, as a view's option is one of
 * `sys.views`'.
 */
function extensionNode(source: SeedSource, at: string): KbNode {
  return {
    id: extensionNodeId(source.name),
    text: source.label,
    props: {},
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * `nodes` with `derived` filed under the list node `rootId`, after the
 * children it already has, and placed right after it.
 */
function fileUnder(nodes: readonly KbNode[], rootId: string, derived: readonly KbNode[]): KbNode[] {
  const rootAt = nodes.findIndex((node) => node.id === rootId);
  const root = nodes[rootAt];
  if (root === undefined) throw new Error(`no seed source declares ${rootId}`);
  return [
    ...nodes.slice(0, rootAt),
    { ...root, children: [...root.children, ...derived.map((node) => node.id)] },
    ...derived,
    ...nodes.slice(rootAt + 1),
  ];
}

/**
 * The seed a store is opened with: every source's nodes, in source order;
 * every source's own node, a child of `sys.extensions` in the same order;
 * and every source's views as option nodes, children of `sys.views` in the
 * same order, with `sys.views` naming the default view type its one
 * provider declares (`defaultViewProps`). Each derived node is placed right
 * after its list. Pure data: it opens nothing, and it throws on an id two
 * sources declare, because that is a bundling defect no store can repair.
 */
export function foldSeed(sources: readonly SeedSource[], at: string = nowIso()): KbNode[] {
  const nodes = sources.flatMap((source) => source.seed?.(at) ?? []);
  const options = sources.flatMap((source) =>
    (source.views ?? []).map((view) => viewOptionNode(view.key, at)),
  );
  const extensions = sources.map((source) => extensionNode(source, at));
  const folded = fileUnder(
    fileUnder(nodes, SYSTEM_IDS.viewsRoot, options),
    SYSTEM_IDS.extensionsRoot,
    extensions,
  );
  const seen = new Set<string>();
  for (const node of folded) {
    if (seen.has(node.id)) throw new Error(`seed id ${node.id} is declared twice`);
    seen.add(node.id);
  }
  // Read once every id is known to have one owner, so a doubled source is
  // refused for its ids first.
  const defaults = defaultViewProps(sources);
  return folded.map((node) =>
    node.id === SYSTEM_IDS.viewsRoot ? { ...node, props: { ...node.props, ...defaults } } : node,
  );
}
