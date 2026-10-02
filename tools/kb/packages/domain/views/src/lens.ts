/**
 * A graph view's lens: the settings a graph view node (a view node whose
 * view is a renderer) stores, as one slot table, and how they decode.
 *
 * What a renderer draws with is a subset of these (`LENS_SETTINGS`); what
 * extraction reads for every renderer alike (the query, the mappings, the
 * edge kinds) is the rest. The extraction itself is the UI's
 * (`@kb/ui`'s `lib/graph-lens.ts`).
 */
import { Schema, SchemaGetter } from "effect";
import {
  GRAPH_LINK_STYLE_VALUES,
  GRAPH_THEME_VALUES,
  SYSTEM_IDS,
  decodeNodeConfig,
  firstBool,
  firstNum,
  firstRef,
  firstStr,
  graphOptionId,
  graphOptionKey,
  graphSourceId,
  graphSourceKey,
  manyOf,
  oneOf,
  viewOptionId,
  type ConfigSlots,
  type NodeProps,
  type PropValue,
} from "@kb/model";
import type { ConfigReport } from "./view-key.ts";

export type EdgeKind = "mention" | "child" | "ref-prop" | `prop:${string}`;

/**
 * A renderer, by the option node that names its view (`sys.view.graph.<name>`,
 * its key's `option`): a graph view node's `sys.f.view`, or the renderer a
 * neighbourhood hosts (`lens.renderer`). Which options are renderers is the
 * renderer views provided, so it is any option id, not a closed enum.
 */
export type LensRenderer = string;

export type LensLayout = "force" | "radial" | "hierarchical" | "grid";
export type LensLabelDensity = "low" | "medium" | "high";

export interface LensPerspective {
  id: string;
  label: string;
  /** EDN datalog → node id set; empty/absent = all nodes. */
  query: string;
  renderer: LensRenderer;
  /** `tag` | `fixed:<hex>` */
  colorBy: string;
  labelBy?: string;
  /** `degree` | `children` | `fixed` */
  sizeBy: string;
  edgeKinds: EdgeKind[];
  maxNodes: number;
  /** `tag:<id>` | `prop:<id>` | `parent` | `none` */
  clusterBy: string;
  /** Tree / ego root node id when set. */
  focus: string | null;
  /** How far a neighbourhood reaches from its focus (`lens.hops`); null when unbounded. */
  hops: number | null;
  layout: LensLayout;
  spread: number;
  linkDistance: number;
  showLabels: boolean;
  autorotate: boolean;
  labelDensity: LensLabelDensity;
  /** The graph's scene theme (`lens.theme`). */
  theme: LensTheme;
  /** How the graph's links are drawn, in every renderer (`lens.link-style`). */
  linkStyle: LensLinkStyle;
}

export type LensTheme = keyof typeof GRAPH_THEME_VALUES;
export type LensLinkStyle = keyof typeof GRAPH_LINK_STYLE_VALUES;

export const DEFAULT_EDGE_KINDS: EdgeKind[] = ["mention", "child"];
export const DEFAULT_MAX_NODES = 500;
export const DEFAULT_COLOR_BY = "tag";
export const DEFAULT_SIZE_BY = "degree";
/** A graph that names no renderer is drawn by the 2D one. */
export const DEFAULT_RENDERER: LensRenderer = viewOptionId("graph.force2d");
/** Fallback when a perspective has no cluster-by prop. Seeded perspectives use `parent`. */
export const DEFAULT_CLUSTER_BY = "parent";
export const DEFAULT_LAYOUT: LensLayout = "force";
export const DEFAULT_SPREAD = 150;
export const DEFAULT_LINK_DISTANCE = 60;
export const DEFAULT_SHOW_LABELS = true;
export const DEFAULT_AUTOROTATE = false;
export const DEFAULT_LABEL_DENSITY: LensLabelDensity = "medium";
export const DEFAULT_THEME: LensTheme = "matte";
export const DEFAULT_LINK_STYLE: LensLinkStyle = "straight";

export const LENS_LAYOUTS: readonly LensLayout[] = ["force", "radial", "hierarchical", "grid"];
export const LENS_LABEL_DENSITIES: readonly LensLabelDensity[] = ["low", "medium", "high"];
/** The option sets' keys, in their declared order (the settings offer them so). */
export const LENS_THEMES = Object.keys(GRAPH_THEME_VALUES).filter(
  (key): key is LensTheme => key in GRAPH_THEME_VALUES,
);
export const LENS_LINK_STYLES = Object.keys(GRAPH_LINK_STYLE_VALUES).filter(
  (key): key is LensLinkStyle => key in GRAPH_LINK_STYLE_VALUES,
);

/*
 * A graph view's lens props, as one slot table.
 *
 * Everything a graph view node (a view node whose view is a renderer) may say
 * about itself is declared here once: the field it is stored under, how a
 * stored value is read from that field, what a legal value is (an Effect
 * `Schema`), and the value used when the node says nothing. `decodeNodeConfig` in `@kb/model` is the only code
 * that walks it, and `frame.ts` declares its own table against the same
 * mechanism.
 */

/**
 * A lens source prop names one of the shared source options.
 *
 * New definitions store a node reference (g1); definitions written before the
 * options were nodes still hold the key as a string, and a user field is
 * stored as a `prop:<field id>` string that no option covers. All three are
 * the same carrier question, so one reader answers it.
 */
const sourceKey =
  (field: string) =>
  (props: NodeProps): string | undefined => {
    const first = props[field]?.[0];
    return first?.t === "ref" ? graphSourceKey(first.v) : firstStr(field)(props);
  };

/**
 * Same shape for a field whose options are its own children (the renderer,
 * the 3D node look, the 3D link style): an option node by reference, or its
 * key as a string.
 */
const optionKey =
  (field: string, values: Parameters<typeof graphOptionKey>[0]) =>
  (props: NodeProps): string | undefined => {
    const first = props[field]?.[0];
    return first?.t === "ref" ? graphOptionKey(values, first.v) : firstStr(field)(props);
  };

/** An option field's value as it is written: the option node, else the key. */
function optionValue(values: Parameters<typeof graphOptionId>[0], key: string): PropValue {
  const id = graphOptionId(values, key);
  return id !== key ? { t: "ref", v: id } : { t: "str", v: key };
}

/**
 * `sys.graph.source.none` — "No grouping" — is what the graph panel writes to
 * `lens.edge-kinds` when every box is unchecked, because an absent prop would
 * mean "unset" and fall back to {@link DEFAULT_EDGE_KINDS}. It names no
 * relationship, so it decodes to nothing rather than being reported as a value
 * this slot could not read.
 */
const NO_EDGE_KIND = "none";

const edgeKindValues = (props: NodeProps): unknown[] | undefined =>
  props[SYSTEM_IDS.lensEdgeKindsField]?.map((value) => {
    const key = value.t === "ref" ? graphSourceKey(value.v) : String(value.v);
    return key === NO_EDGE_KIND ? null : key;
  });

export const EdgeKindSchema = Schema.Union([
  Schema.Literals(["mention", "child", "ref-prop"]),
  Schema.String.pipe(
    Schema.refine((key): key is `prop:${string}` => key.startsWith("prop:"), {
      expected: 'a "prop:<field id>" key',
    }),
  ),
]);

/** A count of nodes: positive, and whole however it was stored. */
const NodeCountSchema = Schema.Finite.check(Schema.isGreaterThan(0)).pipe(
  Schema.decodeTo(Schema.Finite, {
    decode: SchemaGetter.transform((value: number) => Math.floor(value)),
    encode: SchemaGetter.transform((value: number) => value),
  }),
);

/** A force-layout distance: any positive finite number. */
const DistanceSchema = Schema.Finite.check(Schema.isGreaterThan(0));

/**
 * A source is a free-form string on purpose: `tag`, `parent`, `fixed:<hex>`
 * and `prop:<field id>` are all legal, and a key naming an option kb does not
 * know is a user field, not an error (see g1's report).
 */
const SourceSchema = Schema.String;

/**
 * The lens fields a renderer draws with, each with its one schema: what the
 * perspective's slots below validate against, and what a renderer view's
 * params are made of (`graph.ts`), so a renderer declares
 * the settings it reads by naming them here. The mappings (`colorBy`,
 * `sizeBy`, `clusterBy`, `labelBy`), the query and the edge kinds are not
 * among them: extraction reads those, for every renderer alike.
 */
export const LENS_SETTINGS = {
  layout: Schema.Literals(LENS_LAYOUTS),
  spread: DistanceSchema,
  linkDistance: DistanceSchema,
  showLabels: Schema.Boolean,
  autorotate: Schema.Boolean,
  labelDensity: Schema.Literals(LENS_LABEL_DENSITIES),
  theme: Schema.Literals(LENS_THEMES),
  linkStyle: Schema.Literals(LENS_LINK_STYLES),
} satisfies { readonly [K in keyof LensPerspective]?: Schema.Decoder<LensPerspective[K]> };

export type LensSetting = keyof typeof LENS_SETTINGS;

/** Everything the node itself declares; `id` and `label` come from the node. */
export type LensProps = Omit<LensPerspective, "id" | "label">;

const LENS_SLOTS: ConfigSlots<LensProps> = {
  query: oneOf({
    fields: [SYSTEM_IDS.lensQueryField],
    read: firstStr(SYSTEM_IDS.lensQueryField),
    schema: Schema.String,
    fallback: "",
  }),
  renderer: oneOf({
    fields: [SYSTEM_IDS.lensRendererField],
    read: firstRef(SYSTEM_IDS.lensRendererField),
    schema: Schema.String,
    fallback: DEFAULT_RENDERER,
  }),
  colorBy: oneOf({
    fields: [SYSTEM_IDS.lensColorByField],
    read: sourceKey(SYSTEM_IDS.lensColorByField),
    schema: SourceSchema,
    fallback: DEFAULT_COLOR_BY,
  }),
  labelBy: oneOf({
    fields: [SYSTEM_IDS.lensLabelByField],
    read: sourceKey(SYSTEM_IDS.lensLabelByField),
    schema: SourceSchema,
    fallback: "text",
  }),
  sizeBy: oneOf({
    fields: [SYSTEM_IDS.lensSizeByField],
    read: sourceKey(SYSTEM_IDS.lensSizeByField),
    schema: SourceSchema,
    fallback: DEFAULT_SIZE_BY,
  }),
  clusterBy: oneOf({
    fields: [SYSTEM_IDS.lensClusterByField],
    read: sourceKey(SYSTEM_IDS.lensClusterByField),
    schema: SourceSchema,
    fallback: DEFAULT_CLUSTER_BY,
  }),
  edgeKinds: manyOf<EdgeKind>({
    fields: [SYSTEM_IDS.lensEdgeKindsField],
    read: edgeKindValues,
    schema: Schema.NullOr(EdgeKindSchema),
    fallback: DEFAULT_EDGE_KINDS,
  }),
  maxNodes: oneOf({
    fields: [SYSTEM_IDS.lensMaxNodesField],
    read: firstNum(SYSTEM_IDS.lensMaxNodesField),
    schema: NodeCountSchema,
    fallback: DEFAULT_MAX_NODES,
  }),
  focus: oneOf<string | null>({
    fields: [SYSTEM_IDS.lensFocusField],
    read: firstRef(SYSTEM_IDS.lensFocusField),
    schema: Schema.String,
    fallback: null,
  }),
  hops: oneOf<number | null>({
    fields: [SYSTEM_IDS.lensHopsField],
    read: firstNum(SYSTEM_IDS.lensHopsField),
    schema: NodeCountSchema,
    fallback: null,
  }),
  layout: oneOf({
    fields: [SYSTEM_IDS.lensLayoutField],
    read: firstStr(SYSTEM_IDS.lensLayoutField),
    schema: LENS_SETTINGS.layout,
    fallback: DEFAULT_LAYOUT,
  }),
  spread: oneOf({
    fields: [SYSTEM_IDS.lensSpreadField],
    read: firstNum(SYSTEM_IDS.lensSpreadField),
    schema: LENS_SETTINGS.spread,
    fallback: DEFAULT_SPREAD,
  }),
  linkDistance: oneOf({
    fields: [SYSTEM_IDS.lensLinkDistanceField],
    read: firstNum(SYSTEM_IDS.lensLinkDistanceField),
    schema: LENS_SETTINGS.linkDistance,
    fallback: DEFAULT_LINK_DISTANCE,
  }),
  showLabels: oneOf({
    fields: [SYSTEM_IDS.lensShowLabelsField],
    read: firstBool(SYSTEM_IDS.lensShowLabelsField),
    schema: LENS_SETTINGS.showLabels,
    fallback: DEFAULT_SHOW_LABELS,
  }),
  autorotate: oneOf({
    fields: [SYSTEM_IDS.lensAutorotateField],
    read: firstBool(SYSTEM_IDS.lensAutorotateField),
    schema: LENS_SETTINGS.autorotate,
    fallback: DEFAULT_AUTOROTATE,
  }),
  labelDensity: oneOf({
    fields: [SYSTEM_IDS.lensLabelDensityField],
    read: firstStr(SYSTEM_IDS.lensLabelDensityField),
    schema: LENS_SETTINGS.labelDensity,
    fallback: DEFAULT_LABEL_DENSITY,
  }),
  theme: oneOf({
    fields: [SYSTEM_IDS.lensThemeField],
    read: optionKey(SYSTEM_IDS.lensThemeField, GRAPH_THEME_VALUES),
    schema: LENS_SETTINGS.theme,
    fallback: DEFAULT_THEME,
  }),
  linkStyle: oneOf({
    fields: [SYSTEM_IDS.lensLinkStyleField],
    read: optionKey(SYSTEM_IDS.lensLinkStyleField, GRAPH_LINK_STYLE_VALUES),
    schema: LENS_SETTINGS.linkStyle,
    fallback: DEFAULT_LINK_STYLE,
  }),
};

/**
 * The lens a node's props declare, decoded slot by slot: what a renderer
 * view's params read (`RendererKey.config`), and the rest of a perspective.
 * A malformed lens prop falls back to its slot's default and goes to
 * `report`; it never fails the lens, because a bad prop must not make the
 * graph unopenable.
 */
export function decodeLensConfig(props: NodeProps, report: ConfigReport): LensProps {
  const slot = decodeNodeConfig<LensProps>(LENS_SLOTS, props, report);
  return {
    query: slot("query"),
    renderer: slot("renderer"),
    colorBy: slot("colorBy"),
    labelBy: slot("labelBy"),
    sizeBy: slot("sizeBy"),
    clusterBy: slot("clusterBy"),
    edgeKinds: slot("edgeKinds"),
    maxNodes: slot("maxNodes"),
    focus: slot("focus"),
    hops: slot("hops"),
    layout: slot("layout"),
    spread: slot("spread"),
    linkDistance: slot("linkDistance"),
    showLabels: slot("showLabels"),
    autorotate: slot("autorotate"),
    labelDensity: slot("labelDensity"),
    theme: slot("theme"),
    linkStyle: slot("linkStyle"),
  };
}

/** New definitions use node references; legacy source strings remain readable. */
export function sourceValue(key: string): PropValue {
  const id = graphSourceId(key);
  return id !== null ? { t: "ref", v: id } : { t: "str", v: key };
}

/** A graph view node's props for `p`: its renderer is its view, its lens props the params. */
export function perspectiveProps(p: LensPerspective): Record<string, PropValue[]> {
  return {
    [SYSTEM_IDS.viewField]: [{ t: "ref", v: p.renderer }],
    [SYSTEM_IDS.lensQueryField]: [{ t: "str", v: p.query }],
    [SYSTEM_IDS.lensColorByField]: [sourceValue(p.colorBy)],
    [SYSTEM_IDS.lensSizeByField]: [sourceValue(p.sizeBy)],
    [SYSTEM_IDS.lensClusterByField]: [sourceValue(p.clusterBy)],
    [SYSTEM_IDS.lensLabelByField]: [sourceValue(p.labelBy ?? "text")],
    [SYSTEM_IDS.lensEdgeKindsField]: (p.edgeKinds.length ? p.edgeKinds : ["none"]).map(sourceValue),
    ...(p.focus !== null
      ? { [SYSTEM_IDS.lensFocusField]: [{ t: "ref" as const, v: p.focus }] }
      : {}),
    ...(p.hops !== null ? { [SYSTEM_IDS.lensHopsField]: [{ t: "num" as const, v: p.hops }] } : {}),
    [SYSTEM_IDS.lensMaxNodesField]: [{ t: "num", v: p.maxNodes }],
    [SYSTEM_IDS.lensLayoutField]: [{ t: "str", v: p.layout }],
    [SYSTEM_IDS.lensSpreadField]: [{ t: "num", v: p.spread }],
    [SYSTEM_IDS.lensLinkDistanceField]: [{ t: "num", v: p.linkDistance }],
    [SYSTEM_IDS.lensShowLabelsField]: [{ t: "bool", v: p.showLabels }],
    [SYSTEM_IDS.lensAutorotateField]: [{ t: "bool", v: p.autorotate }],
    [SYSTEM_IDS.lensLabelDensityField]: [{ t: "str", v: p.labelDensity }],
    [SYSTEM_IDS.lensThemeField]: [optionValue(GRAPH_THEME_VALUES, p.theme)],
    [SYSTEM_IDS.lensLinkStyleField]: [optionValue(GRAPH_LINK_STYLE_VALUES, p.linkStyle)],
  };
}
