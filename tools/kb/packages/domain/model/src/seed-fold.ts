/**
 * The bundled fold (DESIGN.md → Extension families → the seed is the bundled
 * fold): every declaration's seed nodes and the option node each declared
 * view derives under `sys.views`, folded into the seed a store is opened
 * with.
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
 * seed is the bundled fold): its own system nodes under frozen ids, and the
 * views whose option nodes the fold derives.
 */
export interface SeedSource {
  readonly name: string;
  readonly seed?: (at: string) => readonly KbNode[];
  readonly views?: readonly { readonly key: SeedView }[];
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
 * same order and placed right after it. Pure data: it opens nothing, and it
 * throws on an id two sources declare, because that is a bundling defect no
 * store can repair.
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
  return folded;
}
