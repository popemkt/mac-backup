/**
 * The words the canvas verbs speak (`verbs.ts`): the shapes an agent's input
 * is read in — a canvas, a direction, a colour, looks, heads, a route, an
 * anchor — and the shapes `describe` tells a canvas back in. Each check an
 * input shape makes is `@kb/canvas`'s own (`isCanvasColor`), so a verb
 * refuses what a write would.
 */
import { z } from "zod";
import {
  CANVAS_ALIGNS,
  CANVAS_DASHES,
  CANVAS_DIRECTIONS,
  CANVAS_FILLS,
  CANVAS_FONTS,
  CANVAS_HEADS,
  CANVAS_PALETTE,
  CANVAS_ROUTES,
  CANVAS_SIDES,
  CANVAS_SIZES,
  CANVAS_VALIGNS,
  isCanvasColor,
  isLinkUrl,
  type CanvasHead,
} from "@kb/canvas";

export const CanvasIdSchema = z
  .string()
  .min(1)
  .describe("the #canvas node whose document this acts on");
const Vec = z.object({ x: z.number(), y: z.number(), z: z.number() });
export const Bounds = z.object({ min: Vec, max: Vec });
export const Direction = z
  .enum(CANVAS_DIRECTIONS)
  .describe(
    "along the canvas's own axes, never the camera's: left/right along x, north/south along y " +
      "(north is up the page in 2D), above/below up off the floor",
  );

/** A colour as an agent names one: a palette entry by name, a JSON Canvas preset, or a hex. */
export const ColorSchema = z
  .string()
  .refine(isCanvasColor, "a palette name, a preset 1–6, or a hex")
  .describe(
    `a palette colour by name (${CANVAS_PALETTE.map((p) => p.name).join(", ")}), ` +
      "a JSON Canvas preset 1–6, or a hex; a name is written as its preset",
  );

/** An item's looks beyond its colour (DESIGN.md → Canvas documents, `style`); each defaults by kind. */
export const LooksSchema = z
  .object({
    fill: z.enum(CANVAS_FILLS).describe("its ground: none, semi (a wash of its colour), solid"),
    dash: z.enum(CANVAS_DASHES).describe("its outline: solid, dashed, dotted, or none"),
    size: z.enum(CANVAS_SIZES).describe("how large its words and how heavy its outline"),
    font: z.enum(CANVAS_FONTS).describe("the face its own words are set in"),
    align: z.enum(CANVAS_ALIGNS).describe("its words across its box"),
    valign: z.enum(CANVAS_VALIGNS).describe("its words up and down its box"),
    opacity: z.number().min(0).max(1).describe("how opaque it is drawn, 0 to 1"),
  })
  .partial();

/** An edge's looks (DESIGN.md → Canvas documents, `style`): what of an item's looks a line draws. */
export const EdgeLooksSchema = LooksSchema.pick({ dash: true, size: true, opacity: true }).describe(
  "its line: dash (solid, dashed, dotted, none), size (how heavy, with its heads), opacity",
);

/** The head an edge's end wears, or none. */
export const HeadSchema = z.enum([...CANVAS_HEADS, "none"]);

type HeadInput = z.infer<typeof HeadSchema>;

/** A head as a verb names it, as `@kb/canvas` takes it: null for "none", a bare end. */
const wornHead = (head: HeadInput) => (head === "none" ? null : head);

/**
 * The heads a verb is asked for, as `@kb/canvas` takes them: each end
 * named, null for "none" (a bare end); an end not named is left as it is.
 */
export function headPatch(asked: { readonly fromHead?: HeadInput; readonly toHead?: HeadInput }): {
  fromHead?: CanvasHead | null;
  toHead?: CanvasHead | null;
} {
  return {
    ...(asked.fromHead === undefined ? {} : { fromHead: wornHead(asked.fromHead) }),
    ...(asked.toHead === undefined ? {} : { toHead: wornHead(asked.toHead) }),
  };
}

/** The most points a line an agent makes runs through. */
export const MAX_LINE_POINTS = 256;

export const RouteSchema = z
  .enum(CANVAS_ROUTES)
  .describe("curve (JSON Canvas's, the default), straight, arc, or elbow along the axes");

/** A point of an item's box an edge's end meets, carried onto its outline. */
export const AnchorSchema = z
  .object({
    x: z.number().min(0).max(1).describe("0 its left edge, 1 its right"),
    y: z.number().min(0).max(1).describe("0 its top edge, 1 its bottom"),
  })
  .describe("a point of the item's box, carried out from its centre onto its outline");

/** Where an item leads when followed (DESIGN.md → Canvas documents, `link`). */
export const LinkSchema = z
  .union([
    z.object({ url: z.string().refine(isLinkUrl, "an http, https or mailto address") }).strict(),
    z.object({ node: z.string().min(1), item: z.string().min(1).optional() }).strict(),
    z.object({ item: z.string().min(1) }).strict(),
  ])
  .describe(
    "where it leads when followed: a web address ({url}), a node ({node}; a canvas is a page) " +
      "and an item on that canvas ({node, item}), or an item on this canvas ({item})",
  );

export const DescribedItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  words: z.string(),
  box: Bounds,
  detail: z.enum(["focus", "blurry"]),
  nodeId: z.string().optional(),
  link: LinkSchema.optional(),
  frame: z.string().optional(),
  rotation: z.object({ x: z.number(), y: z.number(), z: z.number() }).partial().optional(),
  faces: z.literal("camera").optional(),
  locked: z.literal(true).optional().describe("held where it is: no verb moves it until unlocked"),
  color: z.string().optional().describe("its colour: a palette name, or as written"),
  style: LooksSchema.optional().describe("the looks it draws that are not its kind's defaults"),
  line: z
    .object({
      points: z.array(z.object({ x: z.number(), y: z.number() })).readonly(),
      closed: z.literal(true).optional(),
      fromHead: z.enum(CANVAS_HEADS).optional(),
      toHead: z.enum(CANVAS_HEADS).optional(),
    })
    .optional()
    .describe("a line's points, whether it closes and the heads it wears, as make.line takes them"),
});

export const RelationSchema = z.union([
  z.object({ kind: z.enum(["on", "in"]), from: z.string(), to: z.string() }),
  z.object({
    kind: z.literal("linked"),
    from: z.string(),
    to: z.string(),
    edge: z.string(),
    label: z.string().optional(),
    field: z.string().optional(),
    fromSide: z.enum(CANVAS_SIDES).optional(),
    toSide: z.enum(CANVAS_SIDES).optional(),
    fromAnchor: z.object({ x: z.number(), y: z.number() }).optional(),
    toAnchor: z.object({ x: z.number(), y: z.number() }).optional(),
    route: RouteSchema.optional(),
    bend: z.number().optional(),
    fromHead: HeadSchema.optional(),
    toHead: HeadSchema.optional(),
    color: z.string().optional().describe("its colour: a palette name, or as written"),
    style: EdgeLooksSchema.optional(),
  }),
  z.object({
    kind: z.literal("near"),
    from: z.string(),
    to: z.string(),
    side: Direction,
    gap: z.number(),
  }),
]);

export const ScreenSchema = z.object({
  tab: z.string(),
  pane: z.string(),
  projection: z.enum(["2d", "3d"]),
  pose: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    zoom: z.number(),
    yaw: z.number(),
    pitch: z.number(),
    fov: z.number(),
  }),
  selection: z.array(z.string()),
  visible: z.array(z.string()),
});
