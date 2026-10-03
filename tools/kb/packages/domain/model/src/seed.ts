import {
  ACTORS,
  ACTOR_OPTION_IDS,
  APPROVAL_DECISIONS,
  APPROVAL_POLICIES_QUERY,
  DECISION_OPTION_IDS,
  approvalPolicyNode,
} from "./approval-policy.ts";
import {
  GRAPH_LINK_STYLE_VALUES,
  GRAPH_THEME_VALUES,
  GRAPH_SOURCE_FIELD_KINDS,
  GRAPH_SOURCE_KINDS,
  GRAPH_SOURCE_KIND_OPTION_IDS,
  GRAPH_SOURCE_VALUES,
  graphSourceTargetQuery,
  type GraphSourceField,
} from "./graph-schema.ts";
import { LEGACY_LENS_ALL_MENTIONS, SYSTEM_IDS, type KbNode, type NodeId, nowIso } from "./model.ts";
import {
  FIELD_TYPES,
  FIELD_TYPE_OPTION_IDS,
  cardinalityValue,
  fieldTypeValue,
  type FieldType,
} from "./field-type.ts";
import { ONTOLOGY_TARGET_QUERY } from "./ontology.ts";
import {
  VIEW_FAMILY_VALUES,
  VIEW_NODE_TARGET_QUERY,
  VIEW_OPTION_TARGET_QUERY,
  viewValueEntries,
  viewFamilyTargetQuery,
  viewOptionId,
} from "./view-node.ts";

/**
 * Tags whose `sys.f.fields` template must stay in sync as fields are added to
 * the seed. Exported because it is a real invariant boundary: the generic
 * fill-absent pass does not apply to these, so the property test that asserts
 * the generic rule has to exclude exactly this set — reading it here instead of
 * restating it is what keeps the two from drifting.
 */
export const TEMPLATE_TAGS: readonly string[] = [SYSTEM_IDS.field, SYSTEM_IDS.ontologyTag];

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

  /*
   * Every seeded field declares its value type — text ones included. A field's
   * declared type is the contract its values are held to, and `fieldTypeOf`
   * reads an absent one as text: right for a user's untyped field, wrong for
   * nearly every system one (`sys.f.type` holds refs, `sys.f.hidden` a bool).
   * So no system field leans on that default; each says what it holds, here,
   * and the fill-absent pass below carries the declaration to older stores.
   */
  const typedField = (
    id: string,
    text: string,
    type: FieldType,
    props: KbNode["props"] = {},
  ): KbNode =>
    mk(id, text, {
      [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }],
      [SYSTEM_IDS.fieldTypeField]: [fieldTypeValue(type)],
      ...props,
    });
  /*
   * A seeded field that is one setting, not a list, says so. Absent means
   * many, so only the single-valued ones carry the declaration — and the
   * fill-absent pass carries it to stores seeded before it existed.
   */
  const one = { [SYSTEM_IDS.cardinalityField]: [cardinalityValue("one")] };
  const singleField = (
    id: string,
    text: string,
    type: FieldType,
    props: KbNode["props"] = {},
  ): KbNode => typedField(id, text, type, { ...one, ...props });

  // A field node's own configuration is a field template, exactly like a tag's.
  // That is what lets one rule — "surface the fields your kinds and tags
  // template" — serve tag pages, field pages, and ordinary tagged nodes alike,
  // instead of a bespoke panel per kind.
  const field = mk(SYSTEM_IDS.field, "sys.field", {
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.fieldTypeField },
      { t: "ref", v: SYSTEM_IDS.cardinalityField },
      { t: "ref", v: SYSTEM_IDS.targetTagField },
      { t: "ref", v: SYSTEM_IDS.targetQueryField },
    ],
  });
  const typeField = typedField(SYSTEM_IDS.typeField, "type", "ref");
  const fieldsField = typedField(SYSTEM_IDS.fieldsField, "fields", "ref");
  const colorField = singleField(SYSTEM_IDS.colorField, "color", "text");
  const hiddenField = singleField(SYSTEM_IDS.hiddenField, "hidden", "checkbox");
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
    ...singleField(SYSTEM_IDS.fieldTypeField, "fieldType", "ref"),
    children: fieldTypeOptions.map((option) => option.id),
  };
  // Cardinality is declared the way a type is: a ref to one of the field's own
  // children. It is one setting itself, so it declares itself single.
  const cardinalityOptions = [
    mk(SYSTEM_IDS.cardinalityOne, "one"),
    mk(SYSTEM_IDS.cardinalityMany, "many"),
  ];
  const cardinalityField: KbNode = {
    ...singleField(SYSTEM_IDS.cardinalityField, "cardinality", "ref"),
    children: cardinalityOptions.map((option) => option.id),
  };
  const targetTagField = typedField(SYSTEM_IDS.targetTagField, "targetTag", "ref");
  const targetQueryField = singleField(SYSTEM_IDS.targetQueryField, "targetQuery", "text");
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
    mk(SYSTEM_IDS.cmdSwitchDesignSystem, "Switch design system", cmdType),
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
    // Panes and layouts
    mk(SYSTEM_IDS.cmdSaveWorkspace, "Save workspace", cmdType),
    mk(SYSTEM_IDS.cmdClosePane, "Close pane", cmdType),
  ];

  // Query nodes as pure system nodes (W4). A query node is any node carrying
  // `sys.f.query`; the field is the kind, so no `#query` supertag is seeded —
  // strip the field and the node is a plain node (DESIGN → Kinds, roles and
  // options).
  const queryField = singleField(SYSTEM_IDS.queryField, "query", "text");
  const queryLimitField = singleField(SYSTEM_IDS.queryLimitField, "limit", "number");

  // A frame view's settings (W7.0), held by its view node. The sort, display and group slots
  // name field nodes; colwidth is a JSON object held as one string.
  const viewSortField = typedField(SYSTEM_IDS.viewSortField, "view.sort", "ref");
  const viewSortDirField = typedField(SYSTEM_IDS.viewSortDirField, "view.sort.dir", "text");
  const viewDisplayField = typedField(SYSTEM_IDS.viewDisplayField, "view.display", "ref");
  const viewColwidthField = singleField(SYSTEM_IDS.viewColwidthField, "view.colwidth", "text");
  const viewPagesizeField = singleField(SYSTEM_IDS.viewPagesizeField, "view.pagesize", "number");
  const viewGroupField = singleField(SYSTEM_IDS.viewGroupField, "view.group", "ref");
  const viewFilterField = typedField(SYSTEM_IDS.viewFilterField, "view.filter", "text");
  const nodeTextField = typedField(SYSTEM_IDS.nodeTextField, "node.text", "text");

  /*
   * View nodes (DESIGN → Kinds, roles and options → View nodes). The views
   * are an option set read by more than one field (`sys.f.view` takes any of
   * them, a renderer choice only the renderers), so they are children of a
   * list node, and each carries its family, which is what a query partitions
   * them by — the shape of the graph sources.
   */
  const viewFamilyOptions = Object.values(VIEW_FAMILY_VALUES).map((value) =>
    mk(value.id, value.label),
  );
  const viewFamilyField: KbNode = {
    ...singleField(SYSTEM_IDS.viewFamilyField, "view.family", "ref"),
    children: viewFamilyOptions.map((option) => option.id),
  };
  const viewOptions = viewValueEntries().map(([viewId, value]) =>
    mk(
      viewOptionId(viewId),
      value.label,
      value.family === undefined
        ? {}
        : { [SYSTEM_IDS.viewFamilyField]: [{ t: "ref", v: VIEW_FAMILY_VALUES[value.family].id }] },
    ),
  );
  const viewsRoot: KbNode = {
    ...mk(SYSTEM_IDS.viewsRoot, "View types"),
    children: viewOptions.map((option) => option.id),
  };

  const refField = (id: string, text: string, targetTag?: string, props: KbNode["props"] = {}) =>
    typedField(id, text, "ref", {
      ...props,
      ...(targetTag !== undefined && targetTag !== ""
        ? { [SYSTEM_IDS.targetTagField]: [{ t: "ref", v: targetTag }] }
        : {}),
    });
  /*
   * A ref field whose allowed targets are the rows of one EDN query — the
   * general form of a target constraint (`sys.f.targetQuery`). Both callers
   * below used to write this object out inline.
   */
  const refQueryField = (
    id: string,
    text: string,
    edn: string,
    props: KbNode["props"] = {},
  ): KbNode =>
    typedField(id, text, "ref", {
      ...props,
      [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }],
    });

  // The view a node is (one option), and the view nodes a host names (many, in order).
  const viewField = refQueryField(SYSTEM_IDS.viewField, "view", VIEW_OPTION_TARGET_QUERY, one);
  const viewsField = refQueryField(SYSTEM_IDS.viewsField, "views", VIEW_NODE_TARGET_QUERY);
  // A docs view's params beside its subject (`lens.query`): which template, written where.
  const viewTemplateField = singleField(SYSTEM_IDS.viewTemplateField, "view.template", "text");
  const viewOutputField = singleField(SYSTEM_IDS.viewOutputField, "view.output", "text");
  const viewSavedQueryField = singleField(
    SYSTEM_IDS.viewSavedQueryField,
    "view.saved-query",
    "text",
  );

  /*
   * Graph vocabulary. Sources are an option *set*, declared by parenting
   * (DESIGN -> Kinds, roles and options). They are ONE list read by five
   * fields, and a node has one parent, so they are children of a list node
   * (`sys.graph.sources`, no tag; the Pinned list is the precedent), they
   * carry the `kind` that used to exist only in TypeScript, and each of the
   * five fields selects the subset it accepts with a `targetQuery` — the
   * shape `surface` uses to select `enforcement`'s children minus `prose`.
   * The renderers are views, so they are options under `sys.views`.
   */
  // Themes and link styles are option sets of one field each, shaped
  // like the renderers: the field's own children.
  const themeOptions = Object.values(GRAPH_THEME_VALUES).map((value) => mk(value.id, value.label));
  const linkStyleOptions = Object.values(GRAPH_LINK_STYLE_VALUES).map((value) =>
    mk(value.id, value.label),
  );
  const sourceKindOptions = GRAPH_SOURCE_KINDS.map((kind) =>
    mk(GRAPH_SOURCE_KIND_OPTION_IDS[kind], kind),
  );
  const graphSourceKindField: KbNode = {
    ...singleField(SYSTEM_IDS.graphSourceKindField, "graph.source.kind", "ref"),
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
  /**
   * A lens field selecting from the shared source list, narrowed to its kind.
   * Every source field but `edge-kinds` selects one source.
   */
  const sourceField = (id: GraphSourceField, text: string, props: KbNode["props"] = one): KbNode =>
    refQueryField(id, text, graphSourceTargetQuery(GRAPH_SOURCE_FIELD_KINDS[id]), props);

  const lensLabelByField = sourceField(SYSTEM_IDS.lensLabelByField, "lens.label-by");
  // Graph perspectives (V0): #graph-perspective tag + lens field template.
  const lensQueryField = singleField(SYSTEM_IDS.lensQueryField, "lens.query", "text");
  // The renderer a graph view hosts (a neighbourhood's): one of the renderer views.
  const lensRendererField = refQueryField(
    SYSTEM_IDS.lensRendererField,
    "lens.renderer",
    viewFamilyTargetQuery("graph.renderer"),
    one,
  );
  const lensColorByField = sourceField(SYSTEM_IDS.lensColorByField, "lens.color-by");
  const lensSizeByField = sourceField(SYSTEM_IDS.lensSizeByField, "lens.size-by");
  const lensEdgeKindsField = sourceField(SYSTEM_IDS.lensEdgeKindsField, "lens.edge-kinds", {});
  const lensMaxNodesField = singleField(SYSTEM_IDS.lensMaxNodesField, "lens.max-nodes", "number");
  const lensClusterByField = sourceField(SYSTEM_IDS.lensClusterByField, "lens.cluster-by");
  const lensFocusField = singleField(SYSTEM_IDS.lensFocusField, "lens.focus", "ref");
  const lensHopsField = singleField(SYSTEM_IDS.lensHopsField, "lens.hops", "number");
  const lensLayoutField = singleField(SYSTEM_IDS.lensLayoutField, "lens.layout", "text");
  const lensSpreadField = singleField(SYSTEM_IDS.lensSpreadField, "lens.spread", "number");
  const lensLinkDistanceField = singleField(
    SYSTEM_IDS.lensLinkDistanceField,
    "lens.link-distance",
    "number",
  );
  const lensShowLabelsField = singleField(
    SYSTEM_IDS.lensShowLabelsField,
    "lens.show-labels",
    "checkbox",
  );
  const lensAutorotateField = singleField(
    SYSTEM_IDS.lensAutorotateField,
    "lens.autorotate",
    "checkbox",
  );
  const lensLabelDensityField = singleField(
    SYSTEM_IDS.lensLabelDensityField,
    "lens.label-density",
    "text",
  );
  const lensThemeField: KbNode = {
    ...refField(SYSTEM_IDS.lensThemeField, "lens.theme", undefined, one),
    children: themeOptions.map((option) => option.id),
  };
  const lensLinkStyleField: KbNode = {
    ...refField(SYSTEM_IDS.lensLinkStyleField, "lens.link-style", undefined, one),
    children: linkStyleOptions.map((option) => option.id),
  };
  // The default graph: a view node whose view is the 2D renderer, and whose
  // lens props are that renderer's params (DESIGN → View nodes).
  const lensAllMentions = mk(SYSTEM_IDS.lensAllMentions, "All mentions", {
    [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("graph.force2d") }],
    [SYSTEM_IDS.lensClusterByField]: [{ t: "ref", v: GRAPH_SOURCE_VALUES.parent.id }],
    [SYSTEM_IDS.lensEdgeKindsField]: [
      { t: "ref", v: GRAPH_SOURCE_VALUES.mention.id },
      { t: "ref", v: GRAPH_SOURCE_VALUES.child.id },
    ],
  });

  // Canvas nodes (C1): #canvas tag templating sys.f.canvas (JSON Canvas 1.0 str).
  const canvasField = singleField(SYSTEM_IDS.canvasField, "canvas", "text");
  // A layout view's arrangement (`layout.grid`): its pane tree as JSON text.
  const layoutField = singleField(SYSTEM_IDS.layoutField, "layout", "text");
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
  const ontoQueryField = singleField(SYSTEM_IDS.ontoQueryField, "onto.query", "text");
  const ontoClosureField = singleField(SYSTEM_IDS.ontoClosureField, "onto.closure", "text");
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
  const refTargetField = refField(SYSTEM_IDS.refTargetField, "ref.target", undefined, one);

  /*
   * The Pinned list. Its children are contextual references to the pinned
   * nodes — a pin is an ordinary reference row, so order, drag-reorder,
   * backlinks and the ⌘K "Turn into reference…" gesture all come for free and
   * no `pinned` supertag has to exist to mark membership.
   *
   * No tag on the node either: it is a list, and being the node the sidebar
   * reads is the whole of what it is.
   */
  /*
   * The sidebar's one seeded pin: the approval policies, managed in their
   * table (below). Every other pin is the person's own.
   */
  const pinnedRoot: KbNode = {
    ...mk(SYSTEM_IDS.pinnedRoot, "Pinned"),
    children: [SYSTEM_IDS.approvalPoliciesPin],
  };

  /*
   * The Views list: where a view node the UI makes is filed — a saved graph,
   * a frame's view. Being a view node is its `sys.f.view`, never membership
   * here, so a view node filed anywhere else is as much one. User-editable
   * for the Pinned list's reason: every new view writes a child into it.
   */
  const viewsList: KbNode = {
    ...mk(SYSTEM_IDS.viewsList, "Views"),
    children: [SYSTEM_IDS.approvalPoliciesView],
  };

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

  /*
   * Approval policies (DESIGN.md → Action registry → Approval). `#approval-policy`
   * is a kind — strip its decision and it is still a policy, badly filled in —
   * so it is a tag templating its three fields. Actors and decisions are option
   * sets of one field each, so they are those fields' children.
   */
  const approvalMatchField = singleField(SYSTEM_IDS.approvalMatchField, "approval.match", "text");
  const actorOptions = ACTORS.map((actor) => mk(ACTOR_OPTION_IDS[actor], actor));
  const approvalActorField: KbNode = {
    ...singleField(SYSTEM_IDS.approvalActorField, "approval.actor", "ref"),
    children: actorOptions.map((option) => option.id),
  };
  const decisionOptions = APPROVAL_DECISIONS.map((decision) =>
    mk(DECISION_OPTION_IDS[decision], decision),
  );
  const approvalDecisionField: KbNode = {
    ...singleField(SYSTEM_IDS.approvalDecisionField, "approval.decision", "ref"),
    children: decisionOptions.map((option) => option.id),
  };
  const approvalPolicyTag = mk(SYSTEM_IDS.approvalPolicyTag, "approval-policy", {
    [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.tag }],
    [SYSTEM_IDS.fieldsField]: [
      { t: "ref", v: SYSTEM_IDS.approvalMatchField },
      { t: "ref", v: SYSTEM_IDS.approvalActorField },
      { t: "ref", v: SYSTEM_IDS.approvalDecisionField },
    ],
  });
  /*
   * The defaults the owner chose: an agent is asked before it deletes a node
   * and before a store-wide rewrite. Normal edits need no policy (no core
   * write declares approval), and a human's gesture never asks because the
   * gesture is the person's answer — a property of the resolver, not a row.
   * They are ordinary, editable nodes, filed under the query node that lists
   * every policy.
   */
  const defaultPolicies = [
    approvalPolicyNode(mk("approval.agent-delete", "An agent asks before deleting a node"), {
      match: "node.delete",
      actor: "agent",
      decision: "ask",
    }),
    approvalPolicyNode(
      mk("approval.agent-views-migrate", "An agent asks before rewriting the store to view nodes"),
      { match: "views.migrate", actor: "agent", decision: "ask" },
    ),
  ];
  /*
   * Policies are managed in a saved table of every `#approval-policy` node,
   * pinned in the sidebar; there is no settings page. The table is an
   * ordinary frame view node over the query node's results, its columns the
   * three fields, so its sort, widths and filters are edited like any view's.
   */
  const approvalPoliciesView = mk(SYSTEM_IDS.approvalPoliciesView, "", {
    [SYSTEM_IDS.viewField]: [{ t: "ref", v: viewOptionId("outline.table") }],
    [SYSTEM_IDS.viewDisplayField]: [
      { t: "ref", v: SYSTEM_IDS.approvalMatchField },
      { t: "ref", v: SYSTEM_IDS.approvalActorField },
      { t: "ref", v: SYSTEM_IDS.approvalDecisionField },
    ],
  });
  const approvalPolicies: KbNode = {
    ...mk(SYSTEM_IDS.approvalPolicies, "Approval policies", {
      [SYSTEM_IDS.queryField]: [{ t: "str", v: APPROVAL_POLICIES_QUERY }],
      [SYSTEM_IDS.viewsField]: [{ t: "ref", v: SYSTEM_IDS.approvalPoliciesView }],
    }),
    children: defaultPolicies.map((policy) => policy.id),
  };
  // GAP [[01M413SPC35K20DFC4TRP4DJYH]]
  const approvalPoliciesPin = mk(SYSTEM_IDS.approvalPoliciesPin, "", {
    [SYSTEM_IDS.refTargetField]: [{ t: "ref", v: SYSTEM_IDS.approvalPolicies }],
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
    cardinalityField,
    ...cardinalityOptions,
    targetTagField,
    targetQueryField,
    command,
    ...commands,
    queryField,
    queryLimitField,
    viewSortField,
    viewSortDirField,
    viewDisplayField,
    viewColwidthField,
    viewPagesizeField,
    viewGroupField,
    viewFilterField,
    nodeTextField,
    viewField,
    viewsField,
    viewTemplateField,
    viewOutputField,
    viewSavedQueryField,
    viewFamilyField,
    ...viewFamilyOptions,
    viewsRoot,
    ...viewOptions,
    lensQueryField,
    graphSourceKindField,
    ...sourceKindOptions,
    graphSourcesRoot,
    ...sourceOptions,
    lensLabelByField,
    lensRendererField,
    lensColorByField,
    lensSizeByField,
    lensEdgeKindsField,
    lensMaxNodesField,
    lensClusterByField,
    lensFocusField,
    lensHopsField,
    lensLayoutField,
    lensSpreadField,
    lensLinkDistanceField,
    lensShowLabelsField,
    lensAutorotateField,
    lensLabelDensityField,
    lensThemeField,
    ...themeOptions,
    lensLinkStyleField,
    ...linkStyleOptions,
    lensAllMentions,
    canvasField,
    layoutField,
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
    viewsList,
    approvalMatchField,
    approvalActorField,
    ...actorOptions,
    approvalDecisionField,
    ...decisionOptions,
    approvalPolicyTag,
    approvalPolicies,
    ...defaultPolicies,
    approvalPoliciesView,
    approvalPoliciesPin,
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
  // The seed has no general retirement: a renamed seeded node lingers in a
  // store opened elsewhere. GAP [[01M3FK1PM9P96SNCSHXF0CJZRA]]
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
   *
   * GAP [[01M3A0ZEWWG0VEHXEM3YNKRQ0Y]] — "absent" cannot tell a key the store
   * never had from one its owner unset, so an unset seeded key comes back on
   * the next open.
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
