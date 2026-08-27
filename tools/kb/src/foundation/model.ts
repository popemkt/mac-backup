import { Clock, Effect, Random } from "effect";
import { ulid } from "ulid";

/**
 * Time and identity seam — the single owner of both nondeterminism sources that
 * would otherwise leak into the store (see DESIGN, t2-dst).
 *
 * Rule 1 (abstraction before addition): Effect already owns these as the
 * `Clock` and `Random` services. Every store-reachable call site must go
 * through one of them; nothing here is a parallel capability record. The
 * harness provides a deterministic `Clock` and a seeded `Random` (`withSeed`),
 * so a whole history replays bit-identically. A grep-based guard test
 * (tests/dst/guard.test.ts) fails if any call site bypasses this seam.
 */

/** Node identity: ULID, or reserved `sys.*` system ids. */
export type NodeId = string;

/**
 * Property values keyed by field-node id.
 * Refs point at other nodes by NodeId.
 * `t`/`v` are correlated (same discriminant as wire + persistence schemas).
 */
export type PropValue =
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "bool"; v: boolean }
  | { t: "date"; v: string }
  | { t: "ref"; v: NodeId };

/** Everything is a node — fields and tags included. */
export interface KbNode {
  id: NodeId;
  text: string;
  /** key = FIELD NODE id, not a display name */
  props: Record<NodeId, PropValue[]>;
  /** ordered outline children */
  children: NodeId[];
  /** Fractional sibling rank. Optional only while legacy JSONL is migrating. */
  order?: string;
  createdAt: string;
  updatedAt: string;
}

export const SYSTEM_IDS = {
  field: "sys.field",
  tag: "sys.tag",
  typeField: "sys.f.type",
  fieldsField: "sys.f.fields",
  /** Optional chip color on tag definition nodes (DESIGN-RESKIN §1.8). */
  colorField: "sys.f.color",
  /** Per-field visibility: when true, field rows are hidden unless debug mode. */
  hiddenField: "sys.f.hidden",
  /** Declared value type on field nodes — a ref to one of the option nodes below. */
  fieldTypeField: "sys.f.fieldType",
  /**
   * Field types are option nodes, not an enum baked into a picker. A field
   * whose value comes from a list is a ref field constrained to nodes carrying
   * the list's tag, and this is that pattern applied to the type slot itself —
   * so the ordinary ref editor renders it and a user's own option list works
   * exactly the same way.
   */
  fieldTypeTag: "sys.tag.field-type",
  ftText: "sys.ft.text",
  ftNumber: "sys.ft.number",
  ftDate: "sys.ft.date",
  ftUrl: "sys.ft.url",
  ftCheckbox: "sys.ft.checkbox",
  ftRef: "sys.ft.ref",
  /** Ref constraint sugar: allowed target tag(s), multi = union. */
  targetTagField: "sys.f.targetTag",
  /** Ref constraint general form: EDN datalog of allowed node ids (wins over tag). */
  targetQueryField: "sys.f.targetQuery",
  /** Type node for palette command nodes (DESIGN-REFINE §2 W3). */
  command: "sys.command",
  cmdAddNode: "sys.cmd.add-node",
  cmdAddTag: "sys.cmd.add-tag",
  cmdDefineField: "sys.cmd.define-field",
  cmdGoQuery: "sys.cmd.go-query",
  cmdNewQuery: "sys.cmd.new-query",
  /** Device prefs + shell commands (DESIGN-RESKIN §1.7 W8a). */
  cmdPreferences: "sys.cmd.preferences",
  cmdToggleTheme: "sys.cmd.toggle-theme",
  cmdToggleWidth: "sys.cmd.toggle-width",
  cmdDebugShowFields: "sys.cmd.debug-show-fields",
  cmdExpandAll: "sys.cmd.expand-all",
  cmdCollapseAll: "sys.cmd.collapse-all",
  /** Query nodes as pure system nodes (DESIGN-REFINE §2 W4). */
  queryTag: "sys.tag.query",
  queryField: "sys.f.query",
  queryLimitField: "sys.f.query.limit",
  /**
   * Contextual references (Tana "contextual content"). A node tagged `#ref`
   * carrying `sys.f.ref.target` displays the target's text; its own children
   * are content local to *that* location. Same shape as a query node — a tag
   * plus one templated field — so it is an ordinary node everywhere else.
   *
   * `sys.f.ref.target` is deliberately unconstrained: a reference may point at
   * any node, and declaring a `targetTag` would be a constraint the feature
   * does not have (cf. `sys.f.onto.member`, unconstrained for the same reason).
   */
  refTag: "sys.tag.ref",
  refTargetField: "sys.f.ref.target",
  /** View configuration field nodes (W7.0). */
  viewModeField: "sys.f.view.mode",
  viewSortField: "sys.f.view.sort",
  viewSortDirField: "sys.f.view.sort.dir",
  viewDisplayField: "sys.f.view.display",
  viewColwidthField: "sys.f.view.colwidth",
  viewPagesizeField: "sys.f.view.pagesize",
  /** W7.1 board group-by field (ref → field node). */
  viewGroupField: "sys.f.view.group",
  /** W7.1 filter clauses (str EDN, multi). */
  viewFilterField: "sys.f.view.filter",
  cmdViewAsList: "sys.cmd.view-as-list",
  cmdViewAsTable: "sys.cmd.view-as-table",
  cmdViewAsBoard: "sys.cmd.view-as-board",
  cmdViewAsCards: "sys.cmd.view-as-cards",
  cmdViewFilter: "sys.cmd.view-filter",
  /** Virtual root for saved queries (.kb/queries/*.edn); never in jsonl. */
  queriesRoot: "sys.queries",
  /** Graph perspective lenses (V0/V1 — graph-lens module). */
  graphPerspectiveTag: "sys.tag.graph-perspective",
  lensQueryField: "sys.f.lens.query",
  lensRendererField: "sys.f.lens.renderer",
  lensColorByField: "sys.f.lens.color-by",
  lensSizeByField: "sys.f.lens.size-by",
  lensEdgeKindsField: "sys.f.lens.edge-kinds",
  lensMaxNodesField: "sys.f.lens.max-nodes",
  /** Cluster key mode: `tag:<id>` | `prop:<id>` | `parent` | `none`. */
  lensClusterByField: "sys.f.lens.cluster-by",
  /** Ego/tree root for tree + local lenses (ref, single). */
  lensFocusField: "sys.f.lens.focus",
  /** Layout sub-mode: `force` | `radial` | `hierarchical` | `grid` (not metro). */
  lensLayoutField: "sys.f.lens.layout",
  /** FA2 / force spread scale (num). */
  lensSpreadField: "sys.f.lens.spread",
  /** Link distance hint for force layouts (num). */
  lensLinkDistanceField: "sys.f.lens.link-distance",
  /** Show node labels (bool). */
  lensShowLabelsField: "sys.f.lens.show-labels",
  /** Curved links (bool). */
  lensCurvedLinksField: "sys.f.lens.curved-links",
  /** 3D autorotate (bool). */
  lensAutorotateField: "sys.f.lens.autorotate",
  /** Label density tier: `low` | `medium` | `high` (str). */
  lensLabelDensityField: "sys.f.lens.label-density",
  /**
   * Default global mentions+child force2d perspective.
   * User-editable (NOT sys-prefixed) so write-guard does not lock it.
   */
  lensAllMentions: "lens.all-mentions",
  /** Canvas nodes (JSON Canvas 1.0 doc on sys.f.canvas). */
  canvasTag: "sys.tag.canvas",
  canvasField: "sys.f.canvas",
  /**
   * Ontologies (r5 core): a named, editable lens over the graph. An ontology
   * is an ordinary node tagged `#ontology` carrying `sys.f.onto.*` props —
   * a new node KIND, not a new node type. Membership bookkeeping lives on
   * the ontology, never on the member (r5 §2.3), so a node that never joins
   * one carries zero ontology props.
   */
  ontologyTag: "sys.tag.ontology",
  /** ref, multi → tag nodes whose instances are members. */
  ontoIncludeField: "sys.f.onto.include",
  /** ref, multi → explicitly pinned member nodes. */
  ontoMemberField: "sys.f.onto.member",
  /** ref, multi → vetoed nodes; absolute, wins over every other source. */
  ontoExcludeField: "sys.f.onto.exclude",
  /** ref, multi → parent ontologies whose members are inherited (superset). */
  ontoExtendsField: "sys.f.onto.extends",
  /** str, single → parameter-free EDN datalog contributing member ids. */
  ontoQueryField: "sys.f.onto.query",
  /** str, single → "none" (default) | "descendants" structural pull. */
  ontoClosureField: "sys.f.onto.closure",
  cmdNewOntology: "sys.cmd.new-ontology",
  cmdEnterOntology: "sys.cmd.enter-ontology",
  cmdExitOntology: "sys.cmd.exit-ontology",
} as const;

/** Pre-fix id — migrated away by ensureSystemSeed. */
export const LEGACY_LENS_ALL_MENTIONS = "sys.lens.all-mentions";

export type SystemId = (typeof SYSTEM_IDS)[keyof typeof SYSTEM_IDS];

export function isSystemId(id: string): id is SystemId {
  return (Object.values(SYSTEM_IDS) as string[]).includes(id);
}

/** Any reserved / seeded id under the `sys.` prefix (browse yes, break no). */
export function isSysPrefixed(id: string): boolean {
  return id.startsWith("sys.");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Milliseconds since epoch → the store's canonical ISO timestamp. Kept as the
 * single formatting point so the store's time shape is owned here.
 */
export function isoFromMillis(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * TIME OWNER — the current instant as an Effect reading the `Clock` service.
 * Store-reachable Effect programs yield this; the harness overrides `Clock`.
 */
export const currentIso: Effect.Effect<string> = Effect.map(
  Clock.currentTimeMillis,
  isoFromMillis,
);

/** Holds the `Random` service as the single source of store identity entropy. */
const randomService = Random.Random;

/**
 * IDENTITY OWNER — a fresh, deterministic node id drawn from the seeded
 * `Random` service and the active `Clock` (ULID is time-ordered). Every id the
 * store mints flows here; the harness seeds `Random` so ids replay identically.
 */
export const freshId: Effect.Effect<NodeId> = Effect.gen(function* () {
  const ms = yield* Clock.currentTimeMillis;
  const rnd = yield* randomService;
  // `ulid(seedTime, …)` treats a falsy seed time as "use Date.now()", which
  // would silently re-introduce the nondeterminism this seam exists to own.
  // Coerce 0 → 1 so an epoch-0 clock still replays deterministically.
  return ulid(ms || 1, () => rnd.nextDoubleUnsafe());
});
