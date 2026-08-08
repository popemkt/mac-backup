import {
  SYSTEM_IDS,
  type KbNode,
  nowIso,
} from "./model.ts";

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
  const graphPerspectiveTag = mk(SYSTEM_IDS.graphPerspectiveTag, "graph-perspective", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.lensQueryField },
      { t: "ref", v: SYSTEM_IDS.lensRendererField },
      { t: "ref", v: SYSTEM_IDS.lensColorByField },
      { t: "ref", v: SYSTEM_IDS.lensSizeByField },
      { t: "ref", v: SYSTEM_IDS.lensEdgeKindsField },
      { t: "ref", v: SYSTEM_IDS.lensMaxNodesField },
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
    lensQueryField,
    lensRendererField,
    lensColorByField,
    lensSizeByField,
    lensEdgeKindsField,
    lensMaxNodesField,
    graphPerspectiveTag,
    lensAllMentions,
  ];
}

/** Merge seed into existing nodes without overwriting user edits to sys.* text/props. */
export function ensureSystemSeed(nodes: KbNode[]): {
  nodes: KbNode[];
  seeded: boolean;
} {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let seeded = false;
  for (const seed of systemSeedNodes()) {
    if (!byId.has(seed.id)) {
      byId.set(seed.id, seed);
      seeded = true;
    }
  }
  return { nodes: [...byId.values()], seeded };
}
