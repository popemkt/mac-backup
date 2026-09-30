/**
 * The move to view nodes, as a store migration: what a store written before
 * view nodes held, rewritten to the shape DESIGN.md → Kinds, roles and options
 * → View nodes states. Run on open beside the seed and the value migrations
 * (`openKbEffect`), so it runs over the store port and holds for every
 * adapter; the store contract proves that.
 *
 * It is a pure function of the node set, so two stores migrated apart write
 * the same nodes (no clock, no fresh ids), and it is idempotent: a store in
 * the new shape comes back as it was.
 */
import { SYSTEM_IDS, type KbNode, type NodeId, type PropValue } from "./model.ts";
import { viewOptionId } from "./view-node.ts";

/** The supertag graph perspectives carried before they were view nodes. Retired. */
export const LEGACY_PERSPECTIVE_TAG = "sys.tag.graph-perspective";

/** The renderers a perspective could name. */
const RENDERER_NAMES = ["force2d", "tree", "cluster", "force3d", "treemap"] as const;
type RendererName = (typeof RENDERER_NAMES)[number];

/** A perspective that named no renderer, or one kb does not know, was drawn in 2D. */
const DEFAULT_RENDERER: RendererName = "force2d";

/** `lens.renderer`'s option children before the renderers were views. Retired. */
const LEGACY_RENDERER_OPTION = (name: RendererName) => `sys.graph.renderer.${name}`;

const RETIRED: ReadonlySet<NodeId> = new Set([
  LEGACY_PERSPECTIVE_TAG,
  ...RENDERER_NAMES.map(LEGACY_RENDERER_OPTION),
]);

/** The renderer a legacy `lens.renderer` value names: an option ref, or its name as text. */
function rendererNamed(value: PropValue | undefined): RendererName | null {
  if (value === undefined) return null;
  const name =
    value.t === "ref"
      ? RENDERER_NAMES.find((candidate) => LEGACY_RENDERER_OPTION(candidate) === value.v)
      : RENDERER_NAMES.find((candidate) => candidate === value.v);
  return name ?? null;
}

const rendererOption = (name: RendererName): PropValue => ({
  t: "ref",
  v: viewOptionId(`graph.${name}`),
});

/** `props` with `field` set to `values`, or without it when there are none. */
function withField(props: KbNode["props"], field: NodeId, values: PropValue[]): KbNode["props"] {
  const { [field]: _dropped, ...rest } = props;
  return values.length === 0 ? rest : { ...rest, [field]: values };
}

/**
 * A graph perspective becomes a view node: the renderer it named is its view
 * (`sys.f.view`), the `#graph-perspective` tag goes, and every other lens
 * prop stays where it is, as that view's params.
 */
function migratePerspective(node: KbNode): KbNode {
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  let props = withField(
    node.props,
    SYSTEM_IDS.typeField,
    types.filter((v) => !(v.t === "ref" && v.v === LEGACY_PERSPECTIVE_TAG)),
  );
  if (props[SYSTEM_IDS.viewField] === undefined) {
    const named = rendererNamed(props[SYSTEM_IDS.lensRendererField]?.[0]);
    props = withField(props, SYSTEM_IDS.lensRendererField, []);
    props = { ...props, [SYSTEM_IDS.viewField]: [rendererOption(named ?? DEFAULT_RENDERER)] };
  }
  return { ...node, props };
}

/**
 * Anywhere else `lens.renderer` names a retired renderer option, it names that
 * renderer's view instead: the renderer a neighbourhood draws with.
 */
function migrateRendererRefs(node: KbNode): KbNode {
  const values = node.props[SYSTEM_IDS.lensRendererField];
  if (values === undefined || !values.some((v) => v.t === "ref" && RETIRED.has(v.v))) return node;
  const remapped = values.map((value) => {
    const named = value.t === "ref" && RETIRED.has(value.v) ? rendererNamed(value) : null;
    return named === null ? value : rendererOption(named);
  });
  return { ...node, props: { ...node.props, [SYSTEM_IDS.lensRendererField]: remapped } };
}

function isPerspective(node: KbNode): boolean {
  return (node.props[SYSTEM_IDS.typeField] ?? []).some(
    (v) => v.t === "ref" && v.v === LEGACY_PERSPECTIVE_TAG,
  );
}

function migrateNode(node: KbNode): KbNode {
  const migrated = migrateRendererRefs(isPerspective(node) ? migratePerspective(node) : node);
  const children = migrated.children.filter((id) => !RETIRED.has(id));
  return children.length === migrated.children.length ? migrated : { ...migrated, children };
}

/**
 * Rewrite a store to view nodes. Returns the nodes to keep — a retired node
 * is left out, which is how the caller's diff deletes it — and whether any
 * node changed.
 */
export function migrateToViewNodes(nodes: KbNode[]): { nodes: KbNode[]; changed: boolean } {
  const out: KbNode[] = [];
  let changed = false;
  for (const node of nodes) {
    if (RETIRED.has(node.id)) {
      changed = true;
      continue;
    }
    const migrated = migrateNode(node);
    if (migrated !== node) changed = true;
    out.push(migrated);
  }
  return { nodes: changed ? out : nodes, changed };
}
