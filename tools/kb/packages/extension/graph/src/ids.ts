/**
 * The graph family's system ids (DESIGN.md → Extension families → ids are
 * frozen data). They kept their spelling when they left core's table, so a
 * store seeded before the move opens without a write. A graph view's subject,
 * its focus and its query, is every view's, so those two stay core's
 * (`SYSTEM_IDS.lensFocusField`, `SYSTEM_IDS.lensQueryField`).
 */
export const GRAPH_IDS = {
  /** The renderer a graph view hosts (a neighbourhood's): one of the renderer views. */
  lensRendererField: "sys.f.lens.renderer",
  lensColorByField: "sys.f.lens.color-by",
  lensSizeByField: "sys.f.lens.size-by",
  lensEdgeKindsField: "sys.f.lens.edge-kinds",
  lensMaxNodesField: "sys.f.lens.max-nodes",
  /** Cluster key mode: `tag:<id>` | `prop:<id>` | `parent` | `none`. */
  lensClusterByField: "sys.f.lens.cluster-by",
  lensLabelByField: "sys.f.lens.label-by",
  /** How many hops out from its focus a neighbourhood reaches (num). */
  lensHopsField: "sys.f.lens.hops",
  /**
   * The shared graph source list. Its children are the ten source options, and
   * the five source-selecting lens fields each narrow them by `kind` through a
   * `targetQuery` — one list, five views of it, because a node has one parent.
   *
   * No tag on the node, same as the Pinned list: it is a list, and being the
   * node those queries read is the whole of what it is (DESIGN -> Kinds, roles
   * and options).
   */
  graphSourcesRoot: "sys.graph.sources",
  /**
   * Which kind of value a source option yields (category / number / label /
   * relationship). Carried by each option node; its own four values are this
   * field's children.
   */
  graphSourceKindField: "sys.f.graph.source.kind",
  /** Layout sub-mode: `force` | `radial` | `hierarchical` | `grid` (not metro). */
  lensLayoutField: "sys.f.lens.layout",
  /** FA2 / force spread scale (num). */
  lensSpreadField: "sys.f.lens.spread",
  /** Link distance hint for force layouts (num). */
  lensLinkDistanceField: "sys.f.lens.link-distance",
  /** Show node labels (bool). */
  lensShowLabelsField: "sys.f.lens.show-labels",
  /** 3D autorotate (bool). */
  lensAutorotateField: "sys.f.lens.autorotate",
  /** Label density tier: `low` | `medium` | `high` (str). */
  lensLabelDensityField: "sys.f.lens.label-density",
  /** The graph's scene theme (ref to one of its option children). */
  lensThemeField: "sys.f.lens.theme",
  /** How the graph's links are drawn, in every renderer (ref to one of its option children). */
  lensLinkStyleField: "sys.f.lens.link-style",
  /**
   * Default global mentions+child force2d perspective.
   * User-editable (NOT sys-prefixed) so write-guard does not lock it.
   */
  lensAllMentions: "lens.all-mentions",
} as const;
