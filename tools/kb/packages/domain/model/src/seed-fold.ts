/**
 * The bundled fold (DESIGN.md → Extension families → the seed is the bundled
 * fold): every declaration's seed nodes, the node each declaration derives
 * under `sys.extensions`, the option node each declared view derives under
 * `sys.views`, the option node each declared option (a backdrop) derives
 * under the field of its kind, and the default view type its one provider
 * declares, folded
 * into the seed a store is opened with, together with which declaration
 * each folded node came from.
 */
import { approvalPolicyNode, type ApprovalPolicy } from "./approval-policy.ts";
import { BACKDROP_OPTIONS, type SeedBackdrop } from "./backdrop.ts";
import { declaredOptionId, type DeclaredOptions, type SeedOption } from "./declared-option.ts";
import { SYSTEM_IDS, extensionNodeId, type KbNode, type NodeId, nowIso } from "./model.ts";
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
  /** The page-head backdrops it contributes; the fold derives each one's option node. */
  readonly backdrops?: readonly SeedBackdrop[];
  /**
   * The approval policies it declares, each a denial: the fold derives each
   * one's node under the list of every policy, editable as any is. A source
   * only forbids, never permits: the most specific policy wins, so one that
   * asked or allowed could outrank a policy the person wrote.
   */
  readonly policies?: readonly SeedPolicy[];
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

/** A policy a source declares: a denial, by its node's id and what it is called. */
export interface SeedPolicy extends Omit<ApprovalPolicy, "decision"> {
  readonly text: string;
  readonly decision: "deny";
}

/** The node of a policy `source` declares; a declared policy that permits anything is refused. */
function policyNode(source: SeedSource, { text, ...policy }: SeedPolicy, at: string): KbNode {
  // A source written outside kb's types (a repository extension) still only forbids.
  const decision: string = policy.decision;
  if (decision !== "deny") {
    throw new Error(`${source.name} declares policy ${policy.id}, which does not deny`);
  }
  const base = { id: policy.id, text, props: {}, children: [], createdAt: at, updatedAt: at };
  return approvalPolicyNode(base, policy);
}

/**
 * Each kind of declared option the fold derives, in the order its options
 * are filed, and where a source lists the things of that kind.
 */
const DECLARED_KINDS: readonly {
  readonly kind: DeclaredOptions;
  readonly of: (source: SeedSource) => readonly SeedOption[] | undefined;
}[] = [{ kind: BACKDROP_OPTIONS, of: (source) => source.backdrops }];

/** The option node that names the declared `option` among `kind`'s, a child of its field. */
function declaredOptionNode(kind: DeclaredOptions, option: SeedOption, at: string): KbNode {
  return {
    id: declaredOptionId(kind, option.id),
    text: option.label,
    props: {},
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
 * One fold, read two ways: the seed a store is opened with, and its
 * provenance, the name of the source each of those nodes came from. A
 * source owns its seed nodes, the option node of each view and each
 * declared option it declares, and its own node; the list nodes the derived ones are filed under stay their
 * declarer's. The owner is known only here, where the fold already proves
 * each id has exactly one, so nothing else keeps a second copy of it.
 */
export interface FoldedSeed {
  readonly nodes: KbNode[];
  readonly owners: ReadonlyMap<NodeId, string>;
}

/**
 * The seed a store is opened with: every source's nodes, in source order;
 * every source's own node, a child of `sys.extensions` in the same order;
 * and every source's views as option nodes, children of `sys.views` in the
 * same order; every source's declared options as option nodes, children of
 * the field of their kind (`sys.f.backdrop`) in the same order; with
 * `sys.views` naming the default view type its one provider declares (`defaultViewProps`). Each derived node is placed right
 * after its list. Each node's owner comes with it ({@link FoldedSeed}).
 * Pure data: it opens nothing, and it throws on an id two sources declare,
 * because that is a bundling defect no store can repair.
 */
export function foldSeed(sources: readonly SeedSource[], at: string = nowIso()): FoldedSeed {
  const parts = sources.map((source) => ({
    name: source.name,
    seed: source.seed?.(at) ?? [],
    options: (source.views ?? []).map((view) => viewOptionNode(view.key, at)),
    declared: DECLARED_KINDS.map(({ kind, of }) =>
      (of(source) ?? []).map((option) => declaredOptionNode(kind, option, at)),
    ),
    policies: (source.policies ?? []).map((policy) => policyNode(source, policy, at)),
    own: extensionNode(source, at),
  }));
  const withViews = fileUnder(
    parts.flatMap((part) => part.seed),
    SYSTEM_IDS.viewsRoot,
    parts.flatMap((part) => part.options),
  );
  const withDeclared = DECLARED_KINDS.reduce(
    (nodes, { kind }, row) =>
      fileUnder(
        nodes,
        kind.field,
        parts.flatMap((part) => part.declared[row] ?? []),
      ),
    withViews,
  );
  const folded = fileUnder(
    fileUnder(
      withDeclared,
      SYSTEM_IDS.approvalPolicies,
      parts.flatMap((part) => part.policies),
    ),
    SYSTEM_IDS.extensionsRoot,
    parts.map((part) => part.own),
  );
  const seen = new Set<string>();
  for (const node of folded) {
    if (seen.has(node.id)) throw new Error(`seed id ${node.id} is declared twice`);
    seen.add(node.id);
  }
  // Read once every id is known to have one owner, so a doubled source is
  // refused for its ids first.
  const defaults = defaultViewProps(sources);
  return {
    nodes: folded.map((node) =>
      node.id === SYSTEM_IDS.viewsRoot ? { ...node, props: { ...node.props, ...defaults } } : node,
    ),
    owners: new Map(
      parts.flatMap((part) =>
        [...part.seed, ...part.options, ...part.declared.flat(), ...part.policies, part.own].map(
          (node) => [node.id, part.name] as const,
        ),
      ),
    ),
  };
}
