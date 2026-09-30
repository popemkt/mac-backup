/**
 * The move to view nodes, as a store migration: what a store written before
 * view nodes held, rewritten to the shape DESIGN.md → Kinds, roles and options
 * → View nodes states. Run on open, after the seed and before the value
 * migrations (`openKbEffect`), so it runs over the store port and holds for
 * every adapter; the store contract proves that.
 *
 * It is a pure function of the node set, so two stores migrated apart write
 * the same nodes (no clock, no fresh ids), and it is idempotent: a store in
 * the new shape comes back as it was.
 */
import { SYSTEM_IDS, type KbNode, type NodeId, type PropValue } from "./model.ts";
import { hostViewIds, isViewNode, viewOptionId } from "./view-node.ts";

/** The supertag graph perspectives carried before they were view nodes. Retired. */
export const LEGACY_PERSPECTIVE_TAG = "sys.tag.graph-perspective";

/** The text field that named a frame's view before a frame named a view node. Retired. */
export const LEGACY_VIEW_MODE_FIELD = "sys.f.view.mode";

/** The renderers a perspective could name. */
const RENDERER_NAMES = ["force2d", "tree", "cluster", "force3d", "treemap"] as const;
type RendererName = (typeof RENDERER_NAMES)[number];

/** A perspective that named no renderer, or one kb does not know, was drawn in 2D. */
const DEFAULT_RENDERER: RendererName = "force2d";

/** `lens.renderer`'s option children before the renderers were views. Retired. */
const LEGACY_RENDERER_OPTION = (name: RendererName) => `sys.graph.renderer.${name}`;

/** The frame views a frame's `sys.f.view.mode` could name. */
const FRAME_MODES = ["list", "table", "board", "cards"] as const;

/** A frame that named no view, or one kb does not know, was shown as a list. */
const DEFAULT_FRAME_MODE = "list";

/** The settings a frame held beside its mode: they are its view node's params now. */
const FRAME_SETTING_FIELDS: readonly NodeId[] = [
  SYSTEM_IDS.viewSortField,
  SYSTEM_IDS.viewSortDirField,
  SYSTEM_IDS.viewDisplayField,
  SYSTEM_IDS.viewColwidthField,
  SYSTEM_IDS.viewPagesizeField,
  SYSTEM_IDS.viewGroupField,
  SYSTEM_IDS.viewFilterField,
];
const FRAME_FIELDS: readonly NodeId[] = [LEGACY_VIEW_MODE_FIELD, ...FRAME_SETTING_FIELDS];

const RETIRED: ReadonlySet<NodeId> = new Set([
  LEGACY_PERSPECTIVE_TAG,
  LEGACY_VIEW_MODE_FIELD,
  ...RENDERER_NAMES.map(LEGACY_RENDERER_OPTION),
]);

/** The view node a migrated frame names: one per frame, derived from its id. */
export function frameViewNodeId(frameId: NodeId): NodeId {
  return `view.${frameId}`;
}

const ref = (v: NodeId): PropValue => ({ t: "ref", v });

/** The renderer a legacy `lens.renderer` value names: an option ref, or its name as text. */
function rendererNamed(value: PropValue | undefined): RendererName | null {
  if (value === undefined) return null;
  const name =
    value.t === "ref"
      ? RENDERER_NAMES.find((candidate) => LEGACY_RENDERER_OPTION(candidate) === value.v)
      : RENDERER_NAMES.find((candidate) => candidate === value.v);
  return name ?? null;
}

const rendererOption = (name: RendererName): PropValue => ref(viewOptionId(`graph.${name}`));

/** `props` with `field` set to `values`, or without it when there are none. */
function withField(props: KbNode["props"], field: NodeId, values: PropValue[]): KbNode["props"] {
  const { [field]: _dropped, ...rest } = props;
  return values.length === 0 ? rest : { ...rest, [field]: values };
}

function isPerspective(node: KbNode): boolean {
  return (node.props[SYSTEM_IDS.typeField] ?? []).some(
    (v) => v.t === "ref" && v.v === LEGACY_PERSPECTIVE_TAG,
  );
}

/**
 * A graph perspective becomes a view node: the renderer it named is its view
 * (`sys.f.view`), the `#graph-perspective` tag goes, and every other lens
 * prop stays where it is, as that view's params. The tag marks the old
 * shape, so `lens.renderer` is its renderer; a view the seed filled in
 * beside it is replaced by that.
 */
function migratePerspective(node: KbNode): KbNode {
  const types = node.props[SYSTEM_IDS.typeField] ?? [];
  const named = rendererNamed(node.props[SYSTEM_IDS.lensRendererField]?.[0]);
  let props = withField(
    node.props,
    SYSTEM_IDS.typeField,
    types.filter((v) => !(v.t === "ref" && v.v === LEGACY_PERSPECTIVE_TAG)),
  );
  props = withField(props, SYSTEM_IDS.lensRendererField, []);
  props = { ...props, [SYSTEM_IDS.viewField]: [rendererOption(named ?? DEFAULT_RENDERER)] };
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

/**
 * Whether a node configures its children with the old `sys.f.view.*` props.
 * A view node carrying them holds them as its params, so it is none.
 */
function isLegacyFrame(node: KbNode): boolean {
  return !isViewNode(node) && FRAME_FIELDS.some((field) => node.props[field] !== undefined);
}

/**
 * A frame's settings become its default view node: the view its mode named
 * (`sys.f.view`, the list's when it named none kb knows), carrying the other
 * settings as they were stored, dated as the frame was last written. The
 * frame names it first in `sys.f.views`, so it is the frame's default.
 */
function frameViewNode(frame: KbNode): KbNode {
  const mode = frame.props[LEGACY_VIEW_MODE_FIELD]?.find((v) => v.t === "str")?.v.trim();
  const view = FRAME_MODES.find((candidate) => candidate === mode) ?? DEFAULT_FRAME_MODE;
  const settings = FRAME_SETTING_FIELDS.flatMap((field) => {
    const values = frame.props[field];
    return values === undefined ? [] : [[field, values] as const];
  });
  return {
    id: frameViewNodeId(frame.id),
    text: "",
    props: {
      [SYSTEM_IDS.viewField]: [ref(viewOptionId(`outline.${view}`))],
      ...Object.fromEntries(settings),
    },
    children: [],
    createdAt: frame.updatedAt,
    updatedAt: frame.updatedAt,
  };
}

function withoutFrameSettings(frame: KbNode, viewId: NodeId): KbNode {
  let props = frame.props;
  for (const field of FRAME_FIELDS) props = withField(props, field, []);
  const views = [viewId, ...hostViewIds(frame).filter((id) => id !== viewId)];
  return { ...frame, props: { ...props, [SYSTEM_IDS.viewsField]: views.map(ref) } };
}

/**
 * Rewrite a store to view nodes. Returns the nodes to keep — a retired node
 * is left out, which is how the caller's diff deletes it — and whether any
 * node changed. A frame's new view node is filed in the Views list, at the
 * forest root when the store has no such list, and a frame whose view node's
 * id is already taken is left as it was.
 */
export function migrateToViewNodes(nodes: KbNode[]): { nodes: KbNode[]; changed: boolean } {
  const ids = new Set(nodes.map((node) => node.id));
  const out: KbNode[] = [];
  const filed: NodeId[] = [];
  let changed = false;
  for (const node of nodes) {
    if (RETIRED.has(node.id)) {
      changed = true;
      continue;
    }
    let migrated = migrateRendererRefs(isPerspective(node) ? migratePerspective(node) : node);
    if (isLegacyFrame(migrated) && !ids.has(frameViewNodeId(migrated.id))) {
      const view = frameViewNode(migrated);
      out.push(view);
      filed.push(view.id);
      migrated = withoutFrameSettings(migrated, view.id);
    }
    const children = migrated.children.filter((id) => !RETIRED.has(id));
    if (children.length !== migrated.children.length) migrated = { ...migrated, children };
    if (migrated !== node) changed = true;
    out.push(migrated);
  }
  if (!changed) return { nodes, changed };
  const list = out.findIndex((node) => node.id === SYSTEM_IDS.viewsList);
  const views = out[list];
  if (views !== undefined && filed.length > 0)
    out[list] = { ...views, children: [...views.children, ...filed] };
  return { nodes: out, changed };
}
