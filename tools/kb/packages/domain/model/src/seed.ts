import {
  GRAPH_RENDERER_VALUES,
  GRAPH_SOURCE_FIELD_KINDS,
  GRAPH_SOURCE_KINDS,
  GRAPH_SOURCE_KIND_OPTION_IDS,
  GRAPH_SOURCE_VALUES,
  graphSourceTargetQuery,
  type GraphSourceField,
} from "./graph-schema.ts";
import { LEGACY_LENS_ALL_MENTIONS, SYSTEM_IDS, type KbNode, type NodeId, nowIso } from "./model.ts";
import { FIELD_TYPES, FIELD_TYPE_OPTION_IDS, fieldTypeValue } from "./field-type.ts";
import { ONTOLOGY_TARGET_QUERY } from "./ontology.ts";

/**
 * Tags whose `sys.f.fields` template must stay in sync as fields are added to
 * the seed. Exported because it is a real invariant boundary: the generic
 * fill-absent pass does not apply to these, so the property test that asserts
 * the generic rule has to exclude exactly this set — reading it here instead of
 * restating it is what keeps the two from drifting.
 */
export const TEMPLATE_TAGS: readonly string[] = [
  SYSTEM_IDS.graphPerspectiveTag,
  SYSTEM_IDS.ontologyTag,
];

/** Reserved system nodes. Idempotent — same ids every time. */
export function systemSeedNodes(at: string = nowIso()): KbNode[] {
  const mk = (id: string, text: string, props: KbNode["props"] = {}): KbNode => ({
    id,
    text,
    props,
    children: [],
    createdAt: at,
    updatedAt: at,
  });

  // A field node's own configuration is a field template, exactly like a tag's.
  // That is what lets one rule — "surface the fields your kinds and tags
  // template" — serve tag pages, field pages, and ordinary tagged nodes alike,
  // instead of a bespoke panel per kind.
  const field = mk(SYSTEM_IDS.field, "sys.field", {
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.fieldTypeField },
      { t: "ref", v: SYSTEM_IDS.targetTagField },
      { t: "ref", v: SYSTEM_IDS.targetQueryField },
    ],
  });
  const typeField = mk(SYSTEM_IDS.typeField, "type", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  const fieldsField = mk(SYSTEM_IDS.fieldsField, "fields", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  const colorField = mk(SYSTEM_IDS.colorField, "color", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  const hiddenField = mk(SYSTEM_IDS.hiddenField, "hidden", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  /*
   * Field types are nodes, and they are the type field's **children** — the
   * option-set shape (DESIGN → Kinds, roles and options). A `field-type`
   * supertag once existed only so `targetTag` had something to point at; it
   * named no concept, because "text" is not a kind of thing, it is one of the
   * values `fieldType` may take. Parenting says exactly that and nothing more,
   * and it is what a user does for their own option list: add a child under
   * the field. The ordinary ref editor renders the type slot either way.
   * The sys options are write-guarded; a user's own list is not.
   */
  const fieldTypeOptions = FIELD_TYPES.map((type) => mk(FIELD_TYPE_OPTION_IDS[type], type));
  const fieldTypeField: KbNode = {
    ...mk(SYSTEM_IDS.fieldTypeField, "fieldType", {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
    }),
    children: fieldTypeOptions.map((option) => option.id),
  };
  const targetTagField = mk(SYSTEM_IDS.targetTagField, "targetTag", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  const targetQueryField = mk(SYSTEM_IDS.targetQueryField, "targetQuery", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  // Deliberately NOT self-typed. `sys.f.type` is the kind slot, and a ref to
  // `sys.tag` there declares "this node is a supertag" — resolveTags skips it
  // precisely so it never renders as a chip. Listing sys.tag among selectable
  // tags would dress a kind change up as tag application, which is a second
  // mechanism for one concept. Promotion is its own gesture instead.
  const tag = mk(SYSTEM_IDS.tag, "sys.tag", {
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.colorField },
      { t: "ref", v: SYSTEM_IDS.hiddenField },
    ],
  });

  // Command type + palette command instances (W3)
  const command = mk(SYSTEM_IDS.command, "sys.command");
  const cmdType = {
    [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.command }],
  };
  const commands: KbNode[] = [
    mk(SYSTEM_IDS.cmdAddNode, "Add node", cmdType),
    mk(SYSTEM_IDS.cmdAddTag, "Add tag", cmdType),
    mk(SYSTEM_IDS.cmdDefineField, "Define field", cmdType),
    mk(SYSTEM_IDS.cmdGoQuery, "Saved queries", cmdType),
    mk(SYSTEM_IDS.cmdNewQuery, "New query node", cmdType),
    // W8a shell commands: device prefs popover + quick toggles
    mk(SYSTEM_IDS.cmdPreferences, "Preferences", cmdType),
    mk(SYSTEM_IDS.cmdToggleTheme, "Toggle theme", cmdType),
    mk(SYSTEM_IDS.cmdToggleWidth, "Toggle width", cmdType),
    mk(SYSTEM_IDS.cmdDebugShowFields, "Debug: show all fields", cmdType),
    mk(SYSTEM_IDS.cmdExpandAll, "Expand all", cmdType),
    mk(SYSTEM_IDS.cmdCollapseAll, "Collapse all", cmdType),
    // W7.1 view mode + filter commands
    mk(SYSTEM_IDS.cmdViewAsList, "View as: List", cmdType),
    mk(SYSTEM_IDS.cmdViewAsTable, "View as: Table", cmdType),
    mk(SYSTEM_IDS.cmdViewAsBoard, "View as: Board", cmdType),
    mk(SYSTEM_IDS.cmdViewAsCards, "View as: Cards", cmdType),
    mk(SYSTEM_IDS.cmdViewFilter, "Filter…", cmdType),
    // r5 ontology commands
    mk(SYSTEM_IDS.cmdNewOntology, "New ontology", cmdType),
    mk(SYSTEM_IDS.cmdEnterOntology, "Enter ontology…", cmdType),
    mk(SYSTEM_IDS.cmdExitOntology, "Exit ontology", cmdType),
  ];

  // Query nodes as pure system nodes (W4). A query node is any node carrying
  // `sys.f.query`; the field is the kind, so no `#query` supertag is seeded —
  // strip the field and the node is a plain node (DESIGN → Kinds, roles and
  // options).
  const fieldType = {
    [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.field }],
  };
  const queryField = mk(SYSTEM_IDS.queryField, "query", fieldType);
  const queryLimitField = mk(SYSTEM_IDS.queryLimitField, "limit", fieldType);

  // View configuration field nodes (W7.0)
  const viewModeField = mk(SYSTEM_IDS.viewModeField, "view.mode", fieldType);
  const viewSortField = mk(SYSTEM_IDS.viewSortField, "view.sort", fieldType);
  const viewSortDirField = mk(SYSTEM_IDS.viewSortDirField, "view.sort.dir", fieldType);
  const viewDisplayField = mk(SYSTEM_IDS.viewDisplayField, "view.display", fieldType);
  const viewColwidthField = mk(SYSTEM_IDS.viewColwidthField, "view.colwidth", fieldType);
  const viewPagesizeField = mk(SYSTEM_IDS.viewPagesizeField, "view.pagesize", fieldType);
  const viewGroupField = mk(SYSTEM_IDS.viewGroupField, "view.group", fieldType);
  const viewFilterField = mk(SYSTEM_IDS.viewFilterField, "view.filter", fieldType);

  const refField = (id: string, text: string, targetTag?: string): KbNode =>
    mk(id, text, {
      ...fieldType,
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
      ...(targetTag !== undefined && targetTag !== ""
        ? { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: targetTag }] }
        : {}),
    });
  /*
   * A ref field whose allowed targets are the rows of one EDN query — the
   * general form of a target constraint (`sys.f.targetQuery`). Both callers
   * below used to write this object out inline.
   */
  const refQueryField = (id: string, text: string, edn: string): KbNode =>
    mk(id, text, {
      ...fieldType,
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
      [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }],
    });

  /*
   * Graph vocabulary. Renderers and sources are option *sets*, so both are
   * declared by parenting (DESIGN -> Kinds, roles and options); the two
   * supertags that once held them templated no fields and existed only so
   * `lens.renderer` had a `targetTag` to name. "2D" is not a kind of thing, it
   * is one of the values `lens.renderer` may take.
   *
   * They are parented differently because they are shaped differently:
   *
   * - the five renderers belong to one field, so they are that field's own
   *   children — exactly `sys.ft.*` under `sys.f.fieldType`;
   * - the ten sources are ONE list read by five fields, and a node has one
   *   parent. So they are children of a list node (`sys.graph.sources`, no tag;
   *   the Pinned list is the precedent), they carry the `kind` that used to
   *   exist only in TypeScript, and each of the five fields selects the subset
   *   it accepts with a `targetQuery` — the shape `surface` uses to select
   *   `enforcement`'s children minus `prose`.
   */
  const rendererOptions = Object.values(GRAPH_RENDERER_VALUES).map((value) =>
    mk(value.id, value.label),
  );
  const sourceKindOptions = GRAPH_SOURCE_KINDS.map((kind) =>
    mk(GRAPH_SOURCE_KIND_OPTION_IDS[kind], kind),
  );
  const graphSourceKindField: KbNode = {
    ...mk(SYSTEM_IDS.graphSourceKindField, "graph.source.kind", {
      ...fieldType,
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("ref")],
    }),
    children: sourceKindOptions.map((option) => option.id),
  };
  const sourceOptions = Object.values(GRAPH_SOURCE_VALUES).map((value) =>
    mk(value.id, value.label, {
      [SYSTEM_IDS.graphSourceKindField]: [
        { t: "ref", v: GRAPH_SOURCE_KIND_OPTION_IDS[value.kind] },
      ],
    }),
  );
  const graphSourcesRoot: KbNode = {
    ...mk(SYSTEM_IDS.graphSourcesRoot, "Graph sources"),
    children: sourceOptions.map((option) => option.id),
  };
  /** A lens field selecting from the shared source list, narrowed to its kind. */
  const sourceField = (id: GraphSourceField, text: string): KbNode =>
    refQueryField(id, text, graphSourceTargetQuery(GRAPH_SOURCE_FIELD_KINDS[id]));

  const lensLabelByField = sourceField(SYSTEM_IDS.lensLabelByField, "lens.label-by");
  // Graph perspectives (V0): #graph-perspective tag + lens field template.
  const lensQueryField = mk(SYSTEM_IDS.lensQueryField, "lens.query", fieldType);
  const lensRendererField: KbNode = {
    ...refField(SYSTEM_IDS.lensRendererField, "lens.renderer"),
    children: rendererOptions.map((option) => option.id),
  };
  const lensColorByField = sourceField(SYSTEM_IDS.lensColorByField, "lens.color-by");
  const lensSizeByField = sourceField(SYSTEM_IDS.lensSizeByField, "lens.size-by");
  const lensEdgeKindsField = sourceField(SYSTEM_IDS.lensEdgeKindsField, "lens.edge-kinds");
  const lensMaxNodesField = mk(SYSTEM_IDS.lensMaxNodesField, "lens.max-nodes", fieldType);
  const lensClusterByField = sourceField(SYSTEM_IDS.lensClusterByField, "lens.cluster-by");
  const lensFocusField = mk(SYSTEM_IDS.lensFocusField, "lens.focus", fieldType);
  const lensLayoutField = mk(SYSTEM_IDS.lensLayoutField, "lens.layout", fieldType);
  const lensSpreadField = mk(SYSTEM_IDS.lensSpreadField, "lens.spread", fieldType);
  const lensLinkDistanceField = mk(
    SYSTEM_IDS.lensLinkDistanceField,
    "lens.link-distance",
    fieldType,
  );
  const lensShowLabelsField = mk(SYSTEM_IDS.lensShowLabelsField, "lens.show-labels", fieldType);
  const lensCurvedLinksField = mk(SYSTEM_IDS.lensCurvedLinksField, "lens.curved-links", fieldType);
  const lensAutorotateField = mk(SYSTEM_IDS.lensAutorotateField, "lens.autorotate", fieldType);
  const lensLabelDensityField = mk(
    SYSTEM_IDS.lensLabelDensityField,
    "lens.label-density",
    fieldType,
  );
  const graphPerspectiveTag = mk(SYSTEM_IDS.graphPerspectiveTag, "graph-perspective", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.lensQueryField },
      { t: "ref", v: SYSTEM_IDS.lensRendererField },
      { t: "ref", v: SYSTEM_IDS.lensColorByField },
      { t: "ref", v: SYSTEM_IDS.lensSizeByField },
      { t: "ref", v: SYSTEM_IDS.lensEdgeKindsField },
      { t: "ref", v: SYSTEM_IDS.lensMaxNodesField },
      { t: "ref", v: SYSTEM_IDS.lensClusterByField },
      { t: "ref", v: SYSTEM_IDS.lensFocusField },
      { t: "ref", v: SYSTEM_IDS.lensLabelByField },
      { t: "ref", v: SYSTEM_IDS.lensLayoutField },
      { t: "ref", v: SYSTEM_IDS.lensSpreadField },
      { t: "ref", v: SYSTEM_IDS.lensLinkDistanceField },
      { t: "ref", v: SYSTEM_IDS.lensShowLabelsField },
      { t: "ref", v: SYSTEM_IDS.lensCurvedLinksField },
      { t: "ref", v: SYSTEM_IDS.lensAutorotateField },
      { t: "ref", v: SYSTEM_IDS.lensLabelDensityField },
    ],
  });
  const lensAllMentions = mk(SYSTEM_IDS.lensAllMentions, "All mentions", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.graphPerspectiveTag }],
    [SYSTEM_IDS.lensRendererField]: [{ t: "ref", v: GRAPH_RENDERER_VALUES.force2d.id }],
    [SYSTEM_IDS.lensClusterByField]: [{ t: "ref", v: GRAPH_SOURCE_VALUES.parent.id }],
    [SYSTEM_IDS.lensEdgeKindsField]: [
      { t: "ref", v: GRAPH_SOURCE_VALUES.mention.id },
      { t: "ref", v: GRAPH_SOURCE_VALUES.child.id },
    ],
  });

  // Canvas nodes (C1): #canvas tag templating sys.f.canvas (JSON Canvas 1.0 str).
  const canvasField = mk(SYSTEM_IDS.canvasField, "canvas", fieldType);
  const canvasTag = mk(SYSTEM_IDS.canvasTag, "canvas", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    [SYSTEM_IDS.fieldsField]: [{ t: "ref", v: SYSTEM_IDS.canvasField }],
  });

  // Ontologies (r5 core): #ontology tag templating the sys.f.onto.* algebra.
  // No default ontology is seeded — an empty ontology list is a legitimate
  // empty state (unlike a graph page with zero perspectives).
  const ontoIncludeField = refField(SYSTEM_IDS.ontoIncludeField, "onto.include", SYSTEM_IDS.tag);
  const ontoMemberField = refField(SYSTEM_IDS.ontoMemberField, "onto.member");
  const ontoExcludeField = refField(SYSTEM_IDS.ontoExcludeField, "onto.exclude");
  // targetQuery (not targetTag) so the ref picker offers only #ontology nodes.
  const ontoExtendsField = refQueryField(
    SYSTEM_IDS.ontoExtendsField,
    "onto.extends",
    ONTOLOGY_TARGET_QUERY,
  );
  const ontoQueryField = mk(SYSTEM_IDS.ontoQueryField, "onto.query", {
    ...fieldType,
    [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("text")],
  });
  const ontoClosureField = mk(SYSTEM_IDS.ontoClosureField, "onto.closure", {
    ...fieldType,
    [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue("text")],
  });
  /*
   * Contextual references: one ref-typed field and nothing else. Same anatomy
   * as a query node — the field is the kind — so a contextual reference is an
   * ordinary node in every other respect: children, tags, collapse state,
   * backlinks and keyboard behaviour all come for free.
   *
   * No target constraint on purpose: a reference may point at any node, and a
   * declared `targetTag` would narrow the picker to a rule the feature does
   * not have. `sys.f.onto.member` is unconstrained for the same reason.
   */
  const refTargetField = refField(SYSTEM_IDS.refTargetField, "ref.target");

  /*
   * The Pinned list. Its children are contextual references to the pinned
   * nodes — a pin is an ordinary reference row, so order, drag-reorder,
   * backlinks and the ⌘K "Turn into reference…" gesture all come for free and
   * no `pinned` supertag has to exist to mark membership.
   *
   * No tag on the node either: it is a list, and being the node the sidebar
   * reads is the whole of what it is.
   */
  const pinnedRoot = mk(SYSTEM_IDS.pinnedRoot, "Pinned");

  const ontologyTag = mk(SYSTEM_IDS.ontologyTag, "ontology", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.ontoIncludeField },
      { t: "ref", v: SYSTEM_IDS.ontoMemberField },
      { t: "ref", v: SYSTEM_IDS.ontoExcludeField },
      { t: "ref", v: SYSTEM_IDS.ontoExtendsField },
      { t: "ref", v: SYSTEM_IDS.ontoQueryField },
      { t: "ref", v: SYSTEM_IDS.ontoClosureField },
    ],
  });

  return [
    field,
    tag,
    typeField,
    fieldsField,
    colorField,
    hiddenField,
    fieldTypeField,
    ...fieldTypeOptions,
    targetTagField,
    targetQueryField,
    command,
    ...commands,
    queryField,
    queryLimitField,
    viewModeField,
    viewSortField,
    viewSortDirField,
    viewDisplayField,
    viewColwidthField,
    viewPagesizeField,
    viewGroupField,
    viewFilterField,
    lensQueryField,
    graphSourceKindField,
    ...sourceKindOptions,
    graphSourcesRoot,
    ...sourceOptions,
    lensLabelByField,
    lensRendererField,
    ...rendererOptions,
    lensColorByField,
    lensSizeByField,
    lensEdgeKindsField,
    lensMaxNodesField,
    lensClusterByField,
    lensFocusField,
    lensLayoutField,
    lensSpreadField,
    lensLinkDistanceField,
    lensShowLabelsField,
    lensCurvedLinksField,
    lensAutorotateField,
    lensLabelDensityField,
    graphPerspectiveTag,
    lensAllMentions,
    canvasField,
    canvasTag,
    ontoIncludeField,
    ontoMemberField,
    ontoExcludeField,
    ontoExtendsField,
    ontoQueryField,
    ontoClosureField,
    ontologyTag,
    refTargetField,
    pinnedRoot,
  ];
}

/**
 * Merge seed into existing nodes without overwriting user edits to sys.* text/props.
 *
 * Also migrates the legacy default perspective `sys.lens.all-mentions` →
 * `lens.all-mentions` (user-editable). If both exist, drop the legacy id;
 * if only legacy exists, rename in place preserving text/props.
 */
export function ensureSystemSeed(
  nodes: KbNode[],
  at: string = nowIso(),
): {
  nodes: KbNode[];
  seeded: boolean;
  /** Ids removed by migration (must be passed to store.commit deletes). */
  deletes: string[];
} {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let seeded = false;
  const deletes: string[] = [];

  // Migrate legacy BEFORE seeding defaults so edits on the old id are kept.
  const legacy = byId.get(LEGACY_LENS_ALL_MENTIONS);
  if (legacy) {
    if (!byId.has(SYSTEM_IDS.lensAllMentions)) {
      byId.set(SYSTEM_IDS.lensAllMentions, {
        ...legacy,
        id: SYSTEM_IDS.lensAllMentions,
      });
    }
    byId.delete(LEGACY_LENS_ALL_MENTIONS);
    deletes.push(LEGACY_LENS_ALL_MENTIONS);
    seeded = true;
  }

  const seedById = new Map<string, KbNode>();
  const seedTemplateTags = new Map<string, KbNode>();
  for (const seed of systemSeedNodes(at)) {
    seedById.set(seed.id, seed);
    if (TEMPLATE_TAGS.includes(seed.id)) seedTemplateTags.set(seed.id, seed);
    if (!byId.has(seed.id)) {
      byId.set(seed.id, seed);
      seeded = true;
    }
  }

  // Merge missing template field refs onto existing template tags
  // (ensureSystemSeed otherwise never rewrites existing sys.* props).
  for (const tagId of TEMPLATE_TAGS) {
    const seedTag = seedTemplateTags.get(tagId);
    const existingTag = byId.get(tagId);
    if (!seedTag || !existingTag) continue;
    const want = seedTag.props[SYSTEM_IDS.fieldsField] ?? [];
    const have = existingTag.props[SYSTEM_IDS.fieldsField] ?? [];
    const haveIds = new Set(have.filter((v) => v.t === "ref").map((v) => v.v));
    const missing = want.filter((v) => v.t === "ref" && !haveIds.has(v.v));
    if (missing.length === 0) continue;
    byId.set(tagId, {
      ...existingTag,
      props: {
        ...existingTag.props,
        [SYSTEM_IDS.fieldsField]: [...have, ...missing],
      },
    });
    seeded = true;
  }

  /*
   * Fill seed prop keys an existing sys.* node has never carried.
   *
   * A key the store already has is a value the owner may have chosen, so it is
   * never rewritten. A key that is absent entirely is not a conflict — it is a
   * prop added to the seed after that store was created, and leaving it absent
   * is what made new system behaviour invisible on older stores. This replaces
   * the one-off "cluster-by=parent when absent" special case, which the seed
   * already declares on lens.all-mentions and which this pass therefore covers
   * exactly; adding the next such default now means editing the seed, not
   * adding another block here.
   */
  for (const seed of seedById.values()) {
    const existing = byId.get(seed.id);
    if (existing === undefined || existing === seed) continue;
    const absent = Object.entries(seed.props).filter(([field]) => !(field in existing.props));
    if (absent.length === 0) continue;
    byId.set(seed.id, {
      ...existing,
      props: { ...existing.props, ...Object.fromEntries(absent) },
    });
    seeded = true;
  }

  if (adoptSeedChildren(byId, seedById)) seeded = true;

  return { nodes: [...byId.values()], seeded, deletes };
}

/**
 * Adopt seed-declared children that nothing currently parents.
 *
 * The seed declares structure as well as props — a field's option set is its
 * children (DESIGN → Kinds, roles and options) — and a store created before
 * that declaration has the option nodes sitting at the forest root. Leaving
 * them there would make the declaration a dead seam: the resolver would derive
 * "the children of this field" and find none.
 *
 * Only orphans are adopted, and that is the whole rule. A node the owner has
 * already filed somewhere is their arrangement; re-parenting it here would both
 * overwrite that and hand the node two parents, which `txIntegrityError` rejects
 * outright. Same posture as the fill-absent props pass: an absent declaration is
 * a seed addition, a present one is a choice.
 */
function adoptSeedChildren(
  byId: Map<NodeId, KbNode>,
  seedById: ReadonlyMap<NodeId, KbNode>,
): boolean {
  const parented = new Set<NodeId>();
  for (const node of byId.values()) {
    for (const childId of node.children) parented.add(childId);
  }
  let adopted = false;
  for (const seed of seedById.values()) {
    const existing = byId.get(seed.id);
    if (existing === undefined || existing === seed) continue;
    const adopt = seed.children.filter((id) => byId.has(id) && !parented.has(id));
    if (adopt.length === 0) continue;
    for (const childId of adopt) parented.add(childId);
    byId.set(seed.id, { ...existing, children: [...existing.children, ...adopt] });
    adopted = true;
  }
  return adopted;
}
