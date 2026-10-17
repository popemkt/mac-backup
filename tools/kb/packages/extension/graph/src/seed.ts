/**
 * The graph family's seed: the graph vocabulary and the default graph, the
 * nodes a graph view node's lens reads, declared the way core declares its
 * own. The bundled seed folds it after core's nodes (DESIGN.md → Extension
 * families → the seed is the bundled fold).
 *
 * Sources are an option *set*, declared by parenting (DESIGN -> Kinds, roles
 * and options). They are ONE list read by five fields, and a node has one
 * parent, so they are children of a list node (`sys.graph.sources`, no tag;
 * the Pinned list is the precedent), they carry the `kind` that used to exist
 * only in TypeScript, and each of the five fields selects the subset it
 * accepts with a `targetQuery` — the shape `surface` uses to select
 * `enforcement`'s children minus `prose`. The renderers are views, so they
 * are options under `sys.views`, which the fold derives from the family's
 * view keys.
 */
import {
  SYSTEM_IDS,
  extensionNodeId,
  seededField,
  viewFamilyTargetQuery,
  type FieldType,
  type KbNode,
} from "@kb/model";
import { GRAPH_IDS } from "./ids.ts";
import {
  GRAPH_LINK_STYLE_VALUES,
  GRAPH_SOURCE_FIELD_KINDS,
  GRAPH_SOURCE_KINDS,
  GRAPH_SOURCE_KIND_OPTION_IDS,
  GRAPH_SOURCE_VALUES,
  graphSourceTargetQuery,
  type GraphSourceField,
} from "./schema.ts";
import { Force2dView } from "./views.ts";

export function graphSeedNodes(at: string): readonly KbNode[] {
  const mk = (id: string, text: string, props: KbNode["props"] = {}): KbNode => ({
    id,
    text,
    props,
    children: [],
    createdAt: at,
    updatedAt: at,
  });
  const singleField = (id: string, text: string, type: FieldType) =>
    seededField(id, text, type, at, { one: true });
  /** A ref field whose allowed targets are the rows of one EDN query. */
  const refQueryField = (id: string, text: string, edn: string, one: boolean) =>
    seededField(id, text, "ref", at, {
      one,
      props: { [SYSTEM_IDS.targetQueryField]: [{ t: "str", v: edn }] },
    });

  // Link styles are an option set of one field, shaped like the renderers:
  // the field's own children. Themes are declared options: the fold derives
  // their nodes under `lens.theme` from the declarations (`themes.ts`).
  const linkStyleOptions = Object.values(GRAPH_LINK_STYLE_VALUES).map((value) =>
    mk(value.id, value.label),
  );
  const sourceKindOptions = GRAPH_SOURCE_KINDS.map((kind) =>
    mk(GRAPH_SOURCE_KIND_OPTION_IDS[kind], kind),
  );
  const graphSourceKindField: KbNode = {
    ...singleField(GRAPH_IDS.graphSourceKindField, "graph.source.kind", "ref"),
    children: sourceKindOptions.map((option) => option.id),
  };
  const sourceOptions = Object.values(GRAPH_SOURCE_VALUES).map((value) =>
    mk(value.id, value.label, {
      [GRAPH_IDS.graphSourceKindField]: [{ t: "ref", v: GRAPH_SOURCE_KIND_OPTION_IDS[value.kind] }],
    }),
  );
  const graphSourcesRoot: KbNode = {
    ...mk(GRAPH_IDS.graphSourcesRoot, "Graph sources"),
    children: sourceOptions.map((option) => option.id),
  };
  /**
   * A lens field selecting from the shared source list, narrowed to its kind.
   * Every source field but `edge-kinds` selects one source.
   */
  const sourceField = (id: GraphSourceField, text: string, one = true): KbNode =>
    refQueryField(id, text, graphSourceTargetQuery(GRAPH_SOURCE_FIELD_KINDS[id]), one);
  /** A lens field whose options are its own children. */
  const optionField = (id: string, text: string, options: readonly KbNode[]): KbNode => ({
    ...singleField(id, text, "ref"),
    children: options.map((option) => option.id),
  });

  // The default graph: a view node whose view is the 2D renderer, and whose
  // lens props are that renderer's params (DESIGN → View nodes).
  const lensAllMentions = mk(GRAPH_IDS.lensAllMentions, "All mentions", {
    [SYSTEM_IDS.viewField]: [{ t: "ref", v: Force2dView.option }],
    [GRAPH_IDS.lensClusterByField]: [{ t: "ref", v: GRAPH_SOURCE_VALUES.parent.id }],
    [GRAPH_IDS.lensEdgeKindsField]: [
      { t: "ref", v: GRAPH_SOURCE_VALUES.mention.id },
      { t: "ref", v: GRAPH_SOURCE_VALUES.child.id },
    ],
  });

  return [
    graphSourceKindField,
    ...sourceKindOptions,
    graphSourcesRoot,
    ...sourceOptions,
    sourceField(GRAPH_IDS.lensLabelByField, "lens.label-by"),
    refQueryField(
      GRAPH_IDS.lensRendererField,
      "lens.renderer",
      viewFamilyTargetQuery("graph.renderer"),
      true,
    ),
    sourceField(GRAPH_IDS.lensColorByField, "lens.color-by"),
    sourceField(GRAPH_IDS.lensSizeByField, "lens.size-by"),
    sourceField(GRAPH_IDS.lensEdgeKindsField, "lens.edge-kinds", false),
    singleField(GRAPH_IDS.lensMaxNodesField, "lens.max-nodes", "number"),
    sourceField(GRAPH_IDS.lensClusterByField, "lens.cluster-by"),
    singleField(GRAPH_IDS.lensHopsField, "lens.hops", "number"),
    singleField(GRAPH_IDS.lensLayoutField, "lens.layout", "text"),
    singleField(GRAPH_IDS.lensSpreadField, "lens.spread", "number"),
    singleField(GRAPH_IDS.lensLinkDistanceField, "lens.link-distance", "number"),
    singleField(GRAPH_IDS.lensShowLabelsField, "lens.show-labels", "checkbox"),
    singleField(GRAPH_IDS.lensEdgeLabelsField, "lens.edge-labels", "checkbox"),
    singleField(GRAPH_IDS.lensAutorotateField, "lens.autorotate", "checkbox"),
    singleField(GRAPH_IDS.lensLabelDensityField, "lens.label-density", "text"),
    optionField(GRAPH_IDS.lensThemeField, "lens.theme", []),
    optionField(GRAPH_IDS.lensLinkStyleField, "lens.link-style", linkStyleOptions),
    ...linkStyleOptions,
    singleField(GRAPH_IDS.lensTraceFromField, "lens.trace-from", "ref"),
    singleField(GRAPH_IDS.lensTraceToField, "lens.trace-to", "ref"),
    singleField(GRAPH_IDS.lensTracePathsField, "lens.trace-paths", "number"),
    lensAllMentions,
    // A setting of the family's own node: written like any field, read where it offers relations.
    seededField(GRAPH_IDS.suggestRelationsField, "suggest relations", "checkbox", at, {
      one: true,
      props: { [SYSTEM_IDS.configuresField]: [{ t: "ref", v: extensionNodeId("graph") }] },
    }),
  ];
}
