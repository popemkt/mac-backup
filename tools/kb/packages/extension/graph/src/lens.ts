/**
 * A graph view's lens: the settings a graph view node (a view node whose
 * view is a renderer) stores, as one slot table, and how they decode.
 *
 * What a renderer draws with is a subset of these (`LENS_SETTINGS`); what
 * extraction reads for every renderer alike (the query, the mappings, the
 * edge kinds) is the lens proper (`LensParams`), which every renderer's
 * params compose. The query and the focus are every view's subject
 * (`@kb/views`' `subject.ts`), so the lens decodes them through the
 * subject's slots. The extraction itself is the kit's (`@kb/ui-sdk`'s
 * `graph-lens.ts`, over this package's edge projection).
 */
import { Schema, SchemaGetter } from "effect";
import {
  declaredIdOf,
  declaredOptionId,
  decodeNodeConfig,
  encodeNodeConfig,
  firstBool,
  firstNum,
  firstRef,
  firstStr,
  manyOf,
  oneOf,
  viewOptionId,
  writeBool,
  writeNum,
  writeRef,
  writeStr,
  type ConfigSlots,
  type NodeProps,
  type PropValue,
  type SlotWrite,
  type Writable,
} from "@kb/model";
import { SUBJECT_SLOTS, type ConfigReport } from "@kb/views";
import { GRAPH_IDS } from "./ids.ts";
import { GRAPH_THEME_OPTIONS, MATTE_THEME } from "./themes.ts";
import {
  GRAPH_LINK_STYLE_VALUES,
  graphOptionId,
  graphOptionKey,
  graphSourceId,
  graphSourceKey,
} from "./schema.ts";

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
  /** Each link drawn with its relation's label (`lens.edge-labels`). */
  edgeLabels: boolean;
  autorotate: boolean;
  labelDensity: LensLabelDensity;
  /** The graph's scene theme (`lens.theme`). */
  theme: LensTheme;
  /** How the graph's links are drawn, in every renderer (`lens.link-style`). */
  linkStyle: LensLinkStyle;
  /**
   * A saved trace: the paths between these two nodes are the graph's node
   * set (`lens.trace-from`, `lens.trace-to`); either null is no trace.
   */
  traceFrom: string | null;
  traceTo: string | null;
  /** How many paths a trace draws (`lens.trace-paths`); null is trace's own default. */
  tracePaths: number | null;
}

/** A graph theme by its declared id (`themes.ts`): one nobody contributes draws the default. */
export type LensTheme = string;
export type LensLinkStyle = keyof typeof GRAPH_LINK_STYLE_VALUES;

export const DEFAULT_EDGE_KINDS: EdgeKind[] = ["mention", "child"];
export const DEFAULT_MAX_NODES = 500;
export const DEFAULT_COLOR_BY = "tag";
/** What a `fixed:` colour source that names no colour draws in. */
export const DEFAULT_FIXED_COLOR = "#888888";
export const DEFAULT_SIZE_BY = "degree";
/** A graph that names no label source labels its nodes by their text. */
const DEFAULT_LABEL_BY = "text";
/** A graph that names no renderer is drawn by the 2D one. */
export const DEFAULT_RENDERER: LensRenderer = viewOptionId("graph.force2d");
/** Fallback when a perspective has no cluster-by prop. Seeded perspectives use `parent`. */
export const DEFAULT_CLUSTER_BY = "parent";
export const DEFAULT_LAYOUT: LensLayout = "force";
export const DEFAULT_SPREAD = 150;
export const DEFAULT_LINK_DISTANCE = 60;
export const DEFAULT_SHOW_LABELS = true;
export const DEFAULT_AUTOROTATE = false;
export const DEFAULT_EDGE_LABELS = false;
export const DEFAULT_LABEL_DENSITY: LensLabelDensity = "medium";
export const DEFAULT_THEME: LensTheme = MATTE_THEME.id;
export const DEFAULT_LINK_STYLE: LensLinkStyle = "straight";

export const LENS_LAYOUTS: readonly LensLayout[] = ["force", "radial", "hierarchical", "grid"];
export const LENS_LABEL_DENSITIES: readonly LensLabelDensity[] = ["low", "medium", "high"];
/** The option set's keys, in their declared order (the settings offer them so). */
export const LENS_LINK_STYLES = Object.keys(GRAPH_LINK_STYLE_VALUES).filter(
  (key): key is LensLinkStyle => key in GRAPH_LINK_STYLE_VALUES,
);

/*
 * A graph view's lens props, as one slot table.
 *
 * Everything a graph view node (a view node whose view is a renderer) may say
 * about itself is declared here once: the field it is stored under, how a
 * stored value is read from that field and how a value is written back to it,
 * what a legal value is (an Effect `Schema`), and the value used when the node
 * says nothing. `decodeNodeConfig` and `encodeNodeConfig` in `@kb/model` are
 * the only code that walks it, and `frame.ts` declares its own table against
 * the same mechanism.
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

/**
 * The theme `lens.theme` names: the declared id its option node names
 * (`GRAPH_THEME_OPTIONS`), or the id as a string, as a definition written
 * before the options were nodes holds it. Which declared ids are
 * contributed is the page's to know, so any id is read here.
 */
const themeKey = (props: NodeProps): string | undefined => {
  const first = props[GRAPH_IDS.lensThemeField]?.[0];
  return first?.t === "ref"
    ? declaredIdOf(GRAPH_THEME_OPTIONS, first.v)
    : firstStr(GRAPH_IDS.lensThemeField)(props);
};

/** An option field's value as it is written: the option node, else the key. */
function optionValue(values: Parameters<typeof graphOptionId>[0], key: string): PropValue {
  const id = graphOptionId(values, key);
  return id !== key ? { t: "ref", v: id } : { t: "str", v: key };
}

/** An option field written as {@link optionValue} writes its value. */
const optionWrite =
  (field: string, values: Parameters<typeof graphOptionId>[0]) =>
  (key: string): SlotWrite => ({ [field]: [optionValue(values, key)] });

/** A source field written as {@link sourceValue} writes its key. */
const sourceWrite =
  (field: string) =>
  (key: string): SlotWrite => ({ [field]: [sourceValue(key)] });

/**
 * `sys.graph.source.none` — "No grouping" — is what the graph panel writes to
 * `lens.edge-kinds` when every box is unchecked, because an absent prop would
 * mean "unset" and fall back to {@link DEFAULT_EDGE_KINDS}. It names no
 * relationship, so it decodes to nothing rather than being reported as a value
 * this slot could not read.
 */
const NO_EDGE_KIND = "none";

const edgeKindValues = (props: NodeProps): unknown[] | undefined =>
  props[GRAPH_IDS.lensEdgeKindsField]?.map((value) => {
    const key = value.t === "ref" ? graphSourceKey(value.v) : String(value.v);
    return key === NO_EDGE_KIND ? null : key;
  });

/** No edge kinds is written as the `none` option, so it reads back as none rather than unset. */
const edgeKindsWrite = (kinds: readonly EdgeKind[]): SlotWrite => ({
  [GRAPH_IDS.lensEdgeKindsField]: (kinds.length > 0 ? kinds : [NO_EDGE_KIND]).map(sourceValue),
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
 * params are made of (`views.ts`), so a renderer declares
 * the settings it reads by naming them here. The mappings (`colorBy`,
 * `sizeBy`, `clusterBy`, `labelBy`), the query and the edge kinds are not
 * among them: extraction reads those, for every renderer alike
 * (`LensParams`).
 */
export const LENS_SETTINGS = {
  layout: Schema.Literals(LENS_LAYOUTS),
  spread: DistanceSchema,
  linkDistance: DistanceSchema,
  showLabels: Schema.Boolean,
  edgeLabels: Schema.Boolean,
  autorotate: Schema.Boolean,
  labelDensity: Schema.Literals(LENS_LABEL_DENSITIES),
  theme: Schema.NonEmptyString.annotate({
    description:
      "A graph theme by its declared id (matte, cel, fresnel, glass, bullet, cube, or a family's own); one nobody contributes draws matte",
  }),
  linkStyle: Schema.Literals(LENS_LINK_STYLES),
} satisfies { readonly [K in keyof LensPerspective]?: Schema.Decoder<LensPerspective[K]> };

export type LensSetting = keyof typeof LENS_SETTINGS;

/**
 * The lens a graph view draws through: which nodes (its query, focus and
 * hops, a saved trace, its edge kinds and node budget) and how they map to marks (colour,
 * label, size, group). Extraction reads it for every renderer alike, so every
 * renderer view's params compose it beside the settings that renderer reads
 * (`views.ts`), and a proposed graph view sets it as it sets those. Each is
 * optional: a view node holding none draws every node, mapped by the defaults.
 */
export const LensParams = Schema.Struct({
  query: Schema.optionalKey(
    Schema.String.annotate({ description: "EDN datalog naming the nodes drawn; empty draws all" }),
  ),
  focus: Schema.optionalKey(
    Schema.NullOr(Schema.String).annotate({ description: "The node the graph is rooted at" }),
  ),
  hops: Schema.optionalKey(
    Schema.NullOr(NodeCountSchema).annotate({ description: "How far from the focus it reaches" }),
  ),
  edgeKinds: Schema.optionalKey(
    Schema.Array(EdgeKindSchema).annotate({ description: "The relationships drawn as links" }),
  ),
  maxNodes: Schema.optionalKey(NodeCountSchema),
  colorBy: Schema.optionalKey(
    SourceSchema.annotate({ description: "tag, fixed:<hex> or prop:<field id>" }),
  ),
  labelBy: Schema.optionalKey(SourceSchema.annotate({ description: "text or prop:<field id>" })),
  sizeBy: Schema.optionalKey(
    SourceSchema.annotate({ description: "degree, children, fixed or prop:<field id>" }),
  ),
  clusterBy: Schema.optionalKey(
    SourceSchema.annotate({ description: "parent, none, tag:<id> or prop:<field id>" }),
  ),
  traceFrom: Schema.optionalKey(
    Schema.NullOr(Schema.String).annotate({
      description:
        "A saved trace's first node: with traceTo, the paths between them are the nodes drawn",
    }),
  ),
  traceTo: Schema.optionalKey(
    Schema.NullOr(Schema.String).annotate({ description: "A saved trace's last node" }),
  ),
  tracePaths: Schema.optionalKey(
    Schema.NullOr(NodeCountSchema).annotate({
      description: "How many shortest paths a saved trace draws",
    }),
  ),
});

/** Everything the node itself declares; `id` and `label` come from the node. */
export type LensProps = Omit<LensPerspective, "id" | "label">;

const LENS_SLOTS: ConfigSlots<LensProps> = {
  // What every view says of its subject, decoded as every view decodes it.
  query: SUBJECT_SLOTS.query,
  renderer: oneOf({
    fields: [GRAPH_IDS.lensRendererField],
    read: firstRef(GRAPH_IDS.lensRendererField),
    write: writeRef(GRAPH_IDS.lensRendererField),
    schema: Schema.String,
    fallback: DEFAULT_RENDERER,
  }),
  colorBy: oneOf({
    fields: [GRAPH_IDS.lensColorByField],
    read: sourceKey(GRAPH_IDS.lensColorByField),
    write: sourceWrite(GRAPH_IDS.lensColorByField),
    schema: SourceSchema,
    fallback: DEFAULT_COLOR_BY,
  }),
  labelBy: oneOf<string | undefined>({
    fields: [GRAPH_IDS.lensLabelByField],
    read: sourceKey(GRAPH_IDS.lensLabelByField),
    write: (key) => sourceWrite(GRAPH_IDS.lensLabelByField)(key ?? DEFAULT_LABEL_BY),
    schema: SourceSchema,
    fallback: DEFAULT_LABEL_BY,
  }),
  sizeBy: oneOf({
    fields: [GRAPH_IDS.lensSizeByField],
    read: sourceKey(GRAPH_IDS.lensSizeByField),
    write: sourceWrite(GRAPH_IDS.lensSizeByField),
    schema: SourceSchema,
    fallback: DEFAULT_SIZE_BY,
  }),
  clusterBy: oneOf({
    fields: [GRAPH_IDS.lensClusterByField],
    read: sourceKey(GRAPH_IDS.lensClusterByField),
    write: sourceWrite(GRAPH_IDS.lensClusterByField),
    schema: SourceSchema,
    fallback: DEFAULT_CLUSTER_BY,
  }),
  edgeKinds: manyOf<EdgeKind>({
    fields: [GRAPH_IDS.lensEdgeKindsField],
    read: edgeKindValues,
    write: edgeKindsWrite,
    schema: Schema.NullOr(EdgeKindSchema),
    fallback: DEFAULT_EDGE_KINDS,
  }),
  maxNodes: oneOf({
    fields: [GRAPH_IDS.lensMaxNodesField],
    read: firstNum(GRAPH_IDS.lensMaxNodesField),
    write: writeNum(GRAPH_IDS.lensMaxNodesField),
    schema: NodeCountSchema,
    fallback: DEFAULT_MAX_NODES,
  }),
  focus: SUBJECT_SLOTS.focus,
  hops: oneOf<number | null>({
    fields: [GRAPH_IDS.lensHopsField],
    read: firstNum(GRAPH_IDS.lensHopsField),
    write: writeNum(GRAPH_IDS.lensHopsField),
    schema: NodeCountSchema,
    fallback: null,
  }),
  layout: oneOf({
    fields: [GRAPH_IDS.lensLayoutField],
    read: firstStr(GRAPH_IDS.lensLayoutField),
    write: writeStr(GRAPH_IDS.lensLayoutField),
    schema: LENS_SETTINGS.layout,
    fallback: DEFAULT_LAYOUT,
  }),
  spread: oneOf({
    fields: [GRAPH_IDS.lensSpreadField],
    read: firstNum(GRAPH_IDS.lensSpreadField),
    write: writeNum(GRAPH_IDS.lensSpreadField),
    schema: LENS_SETTINGS.spread,
    fallback: DEFAULT_SPREAD,
  }),
  linkDistance: oneOf({
    fields: [GRAPH_IDS.lensLinkDistanceField],
    read: firstNum(GRAPH_IDS.lensLinkDistanceField),
    write: writeNum(GRAPH_IDS.lensLinkDistanceField),
    schema: LENS_SETTINGS.linkDistance,
    fallback: DEFAULT_LINK_DISTANCE,
  }),
  showLabels: oneOf({
    fields: [GRAPH_IDS.lensShowLabelsField],
    read: firstBool(GRAPH_IDS.lensShowLabelsField),
    write: writeBool(GRAPH_IDS.lensShowLabelsField),
    schema: LENS_SETTINGS.showLabels,
    fallback: DEFAULT_SHOW_LABELS,
  }),
  edgeLabels: oneOf({
    fields: [GRAPH_IDS.lensEdgeLabelsField],
    read: firstBool(GRAPH_IDS.lensEdgeLabelsField),
    write: writeBool(GRAPH_IDS.lensEdgeLabelsField),
    schema: LENS_SETTINGS.edgeLabels,
    fallback: DEFAULT_EDGE_LABELS,
  }),
  autorotate: oneOf({
    fields: [GRAPH_IDS.lensAutorotateField],
    read: firstBool(GRAPH_IDS.lensAutorotateField),
    write: writeBool(GRAPH_IDS.lensAutorotateField),
    schema: LENS_SETTINGS.autorotate,
    fallback: DEFAULT_AUTOROTATE,
  }),
  labelDensity: oneOf({
    fields: [GRAPH_IDS.lensLabelDensityField],
    read: firstStr(GRAPH_IDS.lensLabelDensityField),
    write: writeStr(GRAPH_IDS.lensLabelDensityField),
    schema: LENS_SETTINGS.labelDensity,
    fallback: DEFAULT_LABEL_DENSITY,
  }),
  theme: oneOf({
    fields: [GRAPH_IDS.lensThemeField],
    read: themeKey,
    write: (id) => ({
      [GRAPH_IDS.lensThemeField]: [{ t: "ref", v: declaredOptionId(GRAPH_THEME_OPTIONS, id) }],
    }),
    schema: LENS_SETTINGS.theme,
    fallback: DEFAULT_THEME,
  }),
  linkStyle: oneOf({
    fields: [GRAPH_IDS.lensLinkStyleField],
    read: optionKey(GRAPH_IDS.lensLinkStyleField, GRAPH_LINK_STYLE_VALUES),
    write: optionWrite(GRAPH_IDS.lensLinkStyleField, GRAPH_LINK_STYLE_VALUES),
    schema: LENS_SETTINGS.linkStyle,
    fallback: DEFAULT_LINK_STYLE,
  }),
  traceFrom: oneOf<string | null>({
    fields: [GRAPH_IDS.lensTraceFromField],
    read: firstRef(GRAPH_IDS.lensTraceFromField),
    write: writeRef(GRAPH_IDS.lensTraceFromField),
    schema: Schema.String,
    fallback: null,
  }),
  traceTo: oneOf<string | null>({
    fields: [GRAPH_IDS.lensTraceToField],
    read: firstRef(GRAPH_IDS.lensTraceToField),
    write: writeRef(GRAPH_IDS.lensTraceToField),
    schema: Schema.String,
    fallback: null,
  }),
  tracePaths: oneOf<number | null>({
    fields: [GRAPH_IDS.lensTracePathsField],
    read: firstNum(GRAPH_IDS.lensTracePathsField),
    write: writeNum(GRAPH_IDS.lensTracePathsField),
    schema: NodeCountSchema,
    fallback: null,
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
    edgeLabels: slot("edgeLabels"),
    autorotate: slot("autorotate"),
    labelDensity: slot("labelDensity"),
    theme: slot("theme"),
    linkStyle: slot("linkStyle"),
    traceFrom: slot("traceFrom"),
    traceTo: slot("traceTo"),
    tracePaths: slot("tracePaths"),
  };
}

/** New definitions use node references; legacy source strings remain readable. */
export function sourceValue(key: string): PropValue {
  const id = graphSourceId(key);
  return id !== null ? { t: "ref", v: id } : { t: "str", v: key };
}

/** The lens props `lens` is stored as: each setting it holds, written by its slot. */
export function encodeLensConfig(lens: LensWrite): Record<string, PropValue[]> {
  return encodeNodeConfig(LENS_SLOTS, lens);
}

/** Lens settings as a view's params hold them: any of them, lists read-only. */
export type LensWrite = { readonly [K in keyof LensProps]?: Writable<LensProps[K]> };
