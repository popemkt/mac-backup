/**
 * The bundled fold (DESIGN.md → Extension families → the seed is the bundled
 * fold): every declaration's seed nodes, the option node each declared view
 * derives under `sys.views`, and the default view type its one provider
 * declares, folded into the seed a store is opened with.
 */
import { SYSTEM_IDS, type KbNode, nowIso } from "./model.ts";
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
 * The seed a store is opened with: every source's nodes, in source order,
 * and every source's views as option nodes, children of `sys.views` in the
 * same order and placed right after it, with `sys.views` naming the default
 * view type its one provider declares (`defaultViewProps`). Pure data: it
 * opens nothing, and it throws on an id two sources declare, because that is
 * a bundling defect no store can repair.
 */
export function foldSeed(sources: readonly SeedSource[], at: string = nowIso()): KbNode[] {
  const nodes = sources.flatMap((source) => source.seed?.(at) ?? []);
  const options = sources.flatMap((source) =>
    (source.views ?? []).map((view) => viewOptionNode(view.key, at)),
  );
  const rootAt = nodes.findIndex((node) => node.id === SYSTEM_IDS.viewsRoot);
  const root = nodes[rootAt];
  if (root === undefined) throw new Error(`no seed source declares ${SYSTEM_IDS.viewsRoot}`);
  const folded = [
    ...nodes.slice(0, rootAt),
    { ...root, children: [...root.children, ...options.map((option) => option.id)] },
    ...options,
    ...nodes.slice(rootAt + 1),
  ];
  const seen = new Set<string>();
  for (const node of folded) {
    if (seen.has(node.id)) throw new Error(`seed id ${node.id} is declared twice`);
    seen.add(node.id);
  }
  // Read once every id is known to have one owner, so a doubled source is
  // refused for its ids first.
  const props = { ...root.props, ...defaultViewProps(sources) };
  return folded.map((node) => (node.id === root.id ? { ...node, props } : node));
}
