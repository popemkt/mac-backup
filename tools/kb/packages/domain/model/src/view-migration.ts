/**
 * The move to view nodes, as a store migration: what a store written before
 * view nodes held, rewritten to the shape DESIGN.md → Kinds, roles and options
 * → View nodes states. It is run by a person or an agent, through the
 * `views.migrate` action, never by opening: opening only reports that a store
 * still holds these shapes (`legacyViewShapes`).
 *
 * It is a pure function of the node set and what the caller passes (the
 * legacy docs views and the stamp they are imported at), so two stores
 * migrated apart with the same input write the same nodes (no clock, no fresh
 * ids), and it is idempotent: a store in the new shape comes back as it was.
 */
import { SYSTEM_IDS, type KbNode, type NodeId, type PropValue } from "./model.ts";
import {
  docsViewNameError,
  docsViewProps,
  viewsWithDefault,
  isViewNode,
  viewOptionId,
  isDocsView,
  type DocsViewSpec,
} from "./view-node.ts";

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

/**
 * `sys.f.view.placement` and its options, seeded for a moment and withdrawn:
 * nothing read them (the placements wait on A2's hosts). Retired.
 */
const RETIRED_PLACEMENT = [
  "sys.f.view.placement",
  "sys.view-placement.inline",
  "sys.view-placement.beside",
  "sys.view-placement.float",
];

const RETIRED: ReadonlySet<NodeId> = new Set([
  LEGACY_PERSPECTIVE_TAG,
  LEGACY_VIEW_MODE_FIELD,
  ...RENDERER_NAMES.map(LEGACY_RENDERER_OPTION),
  ...RETIRED_PLACEMENT,
]);

/**
 * What of the old shape a store still holds, one line each, without changing
 * it: what opening reports, so a person or agent knows to run `views.migrate`.
 */
export function legacyViewShapes(nodes: KbNode[]): string[] {
  const retired = nodes.filter((node) => RETIRED.has(node.id)).map((node) => node.id);
  const perspectives = nodes.filter(isPerspective).length;
  const frames = nodes.filter(isLegacyFrame).length;
  return [
    ...(perspectives > 0 ? [`${perspectives} #graph-perspective node(s)`] : []),
    ...(frames > 0 ? [`${frames} frame(s) holding sys.f.view.* props`] : []),
    ...(retired.length > 0 ? [`retired node(s) ${retired.join(", ")}`] : []),
  ];
}

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
 * Nothing deletes it with its frame. GAP [GAP-ORPHAN-VIEW-NODES]
 */
function frameViewNode(frame: KbNode, id: NodeId): KbNode {
  const mode = frame.props[LEGACY_VIEW_MODE_FIELD]?.find((v) => v.t === "str")?.v.trim();
  const view = FRAME_MODES.find((candidate) => candidate === mode) ?? DEFAULT_FRAME_MODE;
  const settings = FRAME_SETTING_FIELDS.flatMap((field) => {
    const values = frame.props[field];
    return values === undefined ? [] : [[field, values] as const];
  });
  return {
    id,
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
  const views = viewsWithDefault(frame, viewId);
  return { ...frame, props: { ...props, [SYSTEM_IDS.viewsField]: views.map(ref) } };
}

/** A docs view spec a root kept as `.kb/views/<name>.json` before docs views were view nodes. */
export interface LegacyDocsView {
  readonly name: string;
  readonly spec: DocsViewSpec;
}

/**
 * What a store's root held beside the store before view nodes, and the stamp
 * an imported docs view carries: nothing in a spec file says when it was
 * written, so the caller says, and the same `at` gives the same nodes.
 */
export interface LegacyViews {
  readonly docs: readonly LegacyDocsView[];
  readonly at: string;
}

/** What a migration did beyond the nodes it returns. */
export interface ViewMigration {
  readonly nodes: KbNode[];
  readonly changed: boolean;
  /** The legacy docs views it imported, by name: their files have nothing left to say. */
  readonly imported: readonly string[];
  /** What it could not do as asked, one line each: a collision, a view it left alone. */
  readonly warnings: readonly string[];
}

/** The first of `id`, `id.2`, `id.3`, … that `taken` does not hold. */
function freeId(id: NodeId, taken: ReadonlySet<NodeId>): NodeId {
  let candidate = id;
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}.${n}`;
  return candidate;
}

/** The view node a legacy docs view spec becomes, derived from its name. */
export function docsViewNodeId(name: string): NodeId {
  return `docs.${name}`;
}

/** A legacy docs view spec as a docs view node: named by its text, its spec its params. */
function docsViewNode(view: LegacyDocsView, at: string): KbNode {
  return {
    id: docsViewNodeId(view.name),
    text: view.name,
    props: docsViewProps(view.spec),
    children: [],
    createdAt: at,
    updatedAt: at,
  };
}

/**
 * The legacy docs views to import, each as its node, and what to say about
 * the ones left out: a name whose `docs.<name>` a docs view already holds is
 * imported already, one a node that is no docs view holds cannot be, and a
 * name another docs view goes by would be a second view of that name
 * (`docsViewNameError`).
 */
function docsImports(
  legacy: LegacyViews,
  byId: ReadonlyMap<NodeId, KbNode>,
  warnings: string[],
): KbNode[] {
  return legacy.docs.flatMap((view) => {
    const id = docsViewNodeId(view.name);
    const holder = byId.get(id);
    const node = docsViewNode(view, legacy.at);
    const nameError = docsViewNameError(node, byId.values());
    if (holder === undefined && nameError === null) return [node];
    warnings.push(
      holder === undefined
        ? `${nameError}; docs view ${view.name} was not imported`
        : isDocsView(holder)
          ? `docs view ${view.name} is already ${id}; its spec file was not imported again`
          : `${id} is a node that is no docs view; docs view ${view.name} was not imported`,
    );
    return [];
  });
}

/**
 * Rewrite a store to view nodes. Returns the nodes to keep — a retired node
 * is left out, which is how the caller's diff deletes it — whether any node
 * changed, the legacy docs views it imported, and a warning for everything it
 * could not do as asked. A new view node is filed in the Views list (at the
 * forest root when the store has no such list). A frame whose `view.<id>` is
 * taken gets the next free `view.<id>.<n>`, so no frame is left in the old
 * shape.
 */
export function migrateToViewNodes(nodes: KbNode[], legacy: LegacyViews): ViewMigration {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ids = new Set(byId.keys());
  const warnings: string[] = [];
  const out = docsImports(legacy, byId, warnings);
  const imported = out.map((node) => node.text);
  const filed = out.map((node) => node.id);
  for (const id of filed) ids.add(id);
  let changed = out.length > 0;
  for (const node of nodes) {
    if (RETIRED.has(node.id)) {
      changed = true;
      continue;
    }
    let migrated = migrateRendererRefs(isPerspective(node) ? migratePerspective(node) : node);
    if (isLegacyFrame(migrated)) {
      const id = freeId(frameViewNodeId(migrated.id), ids);
      if (id !== frameViewNodeId(migrated.id))
        warnings.push(
          `${frameViewNodeId(migrated.id)} is taken; frame ${migrated.id}'s view node is ${id}`,
        );
      ids.add(id);
      const view = frameViewNode(migrated, id);
      out.push(view);
      filed.push(view.id);
      migrated = withoutFrameSettings(migrated, view.id);
    }
    const children = migrated.children.filter((id) => !RETIRED.has(id));
    if (children.length !== migrated.children.length) migrated = { ...migrated, children };
    if (migrated !== node) changed = true;
    out.push(migrated);
  }
  if (!changed) return { nodes, changed, imported, warnings };
  const list = out.findIndex((node) => node.id === SYSTEM_IDS.viewsList);
  const views = out[list];
  if (views !== undefined && filed.length > 0)
    out[list] = { ...views, children: [...views.children, ...filed] };
  return { nodes: out, changed, imported, warnings };
}
