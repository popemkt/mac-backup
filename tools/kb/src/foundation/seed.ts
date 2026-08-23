import {
  LEGACY_LENS_ALL_MENTIONS,
  SYSTEM_IDS,
  type KbNode,
  nowIso,
} from "./model.ts";
import { ONTOLOGY_TARGET_QUERY } from "./ontology.ts";

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

  const field = mk(SYSTEM_IDS.field, "sys.field");
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
  const fieldTypeField = mk(SYSTEM_IDS.fieldTypeField, "fieldType", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  const targetTagField = mk(SYSTEM_IDS.targetTagField, "targetTag", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
  const targetQueryField = mk(SYSTEM_IDS.targetQueryField, "targetQuery", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
  });
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

  // Query nodes as pure system nodes (W4): a tag "query" templating the
  // EDN definition + optional result cap fields. A query node is any node
  // tagged #query carrying sys.f.query.
  const fieldType = {
    [SYSTEM_IDS.typeField]: [{ t: "ref" as const, v: SYSTEM_IDS.field }],
  };
  const queryField = mk(SYSTEM_IDS.queryField, "query", fieldType);
  const queryLimitField = mk(SYSTEM_IDS.queryLimitField, "limit", fieldType);
  const queryTag = mk(SYSTEM_IDS.queryTag, "query", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.queryField },
      { t: "ref", v: SYSTEM_IDS.queryLimitField },
    ],
  });

  // View configuration field nodes (W7.0)
  const viewModeField = mk(SYSTEM_IDS.viewModeField, "view.mode", fieldType);
  const viewSortField = mk(SYSTEM_IDS.viewSortField, "view.sort", fieldType);
  const viewSortDirField = mk(
    SYSTEM_IDS.viewSortDirField,
    "view.sort.dir",
    fieldType,
  );
  const viewDisplayField = mk(
    SYSTEM_IDS.viewDisplayField,
    "view.display",
    fieldType,
  );
  const viewColwidthField = mk(
    SYSTEM_IDS.viewColwidthField,
    "view.colwidth",
    fieldType,
  );
  const viewPagesizeField = mk(
    SYSTEM_IDS.viewPagesizeField,
    "view.pagesize",
    fieldType,
  );
  const viewGroupField = mk(SYSTEM_IDS.viewGroupField, "view.group", fieldType);
  const viewFilterField = mk(
    SYSTEM_IDS.viewFilterField,
    "view.filter",
    fieldType,
  );

  // Graph perspectives (V0): #graph-perspective tag + lens field template.
  const lensQueryField = mk(SYSTEM_IDS.lensQueryField, "lens.query", fieldType);
  const lensRendererField = mk(
    SYSTEM_IDS.lensRendererField,
    "lens.renderer",
    fieldType,
  );
  const lensColorByField = mk(
    SYSTEM_IDS.lensColorByField,
    "lens.color-by",
    fieldType,
  );
  const lensSizeByField = mk(
    SYSTEM_IDS.lensSizeByField,
    "lens.size-by",
    fieldType,
  );
  const lensEdgeKindsField = mk(
    SYSTEM_IDS.lensEdgeKindsField,
    "lens.edge-kinds",
    fieldType,
  );
  const lensMaxNodesField = mk(
    SYSTEM_IDS.lensMaxNodesField,
    "lens.max-nodes",
    fieldType,
  );
  const lensClusterByField = mk(
    SYSTEM_IDS.lensClusterByField,
    "lens.cluster-by",
    fieldType,
  );
  const lensFocusField = mk(SYSTEM_IDS.lensFocusField, "lens.focus", fieldType);
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
    ],
  });
  const lensAllMentions = mk(SYSTEM_IDS.lensAllMentions, "All mentions", {
    [SYSTEM_IDS.typeField]: [
      { t: "ref", v: SYSTEM_IDS.graphPerspectiveTag },
    ],
    [SYSTEM_IDS.lensRendererField]: [{ t: "str", v: "force2d" }],
    [SYSTEM_IDS.lensEdgeKindsField]: [
      { t: "str", v: "mention" },
      { t: "str", v: "child" },
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
  const refField = (id: string, text: string, targetTag?: string): KbNode =>
    mk(id, text, {
      ...fieldType,
      [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
      ...(targetTag
        ? { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: targetTag }] }
        : {}),
    });
  const ontoIncludeField = refField(
    SYSTEM_IDS.ontoIncludeField,
    "onto.include",
    SYSTEM_IDS.tag,
  );
  const ontoMemberField = refField(SYSTEM_IDS.ontoMemberField, "onto.member");
  const ontoExcludeField = refField(SYSTEM_IDS.ontoExcludeField, "onto.exclude");
  // targetQuery (not targetTag) so the ref picker offers only #ontology nodes.
  const ontoExtendsField = mk(SYSTEM_IDS.ontoExtendsField, "onto.extends", {
    ...fieldType,
    [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "ref" }],
    [SYSTEM_IDS.targetQueryField]: [
      { t: "str", v: ONTOLOGY_TARGET_QUERY },
    ],
  });
  const ontoQueryField = mk(SYSTEM_IDS.ontoQueryField, "onto.query", {
    ...fieldType,
    [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "text" }],
  });
  const ontoClosureField = mk(SYSTEM_IDS.ontoClosureField, "onto.closure", {
    ...fieldType,
    [SYSTEM_IDS.fieldTypeField]: [{ t: "str", v: "text" }],
  });
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
    targetTagField,
    targetQueryField,
    command,
    ...commands,
    queryField,
    queryLimitField,
    queryTag,
    viewModeField,
    viewSortField,
    viewSortDirField,
    viewDisplayField,
    viewColwidthField,
    viewPagesizeField,
    viewGroupField,
    viewFilterField,
    lensQueryField,
    lensRendererField,
    lensColorByField,
    lensSizeByField,
    lensEdgeKindsField,
    lensMaxNodesField,
    lensClusterByField,
    lensFocusField,
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
  ];
}

/**
 * Merge seed into existing nodes without overwriting user edits to sys.* text/props.
 *
 * Also migrates the legacy default perspective `sys.lens.all-mentions` →
 * `lens.all-mentions` (user-editable). If both exist, drop the legacy id;
 * if only legacy exists, rename in place preserving text/props.
 */
export function ensureSystemSeed(nodes: KbNode[]): {
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

  /** Tags whose sys.f.fields template must stay in sync as fields are added. */
  const TEMPLATE_TAGS: readonly string[] = [
    SYSTEM_IDS.graphPerspectiveTag,
    SYSTEM_IDS.ontologyTag,
  ];

  const seedTemplateTags = new Map<string, KbNode>();
  for (const seed of systemSeedNodes()) {
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
    const haveIds = new Set(
      have.filter((v) => v.t === "ref").map((v) => String(v.v)),
    );
    const missing = want.filter(
      (v) => v.t === "ref" && !haveIds.has(String(v.v)),
    );
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

  return { nodes: [...byId.values()], seeded, deletes };
}
