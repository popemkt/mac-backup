import { typeRefsOf } from "@kb/model";
import { isSysPrefixed, SYSTEM_IDS, type OutlineNode } from "@/lib/types";
import { nodeTagColors, tagColorFill } from "@/lib/tag-color";
import { textHasAssetRef } from "@/lib/md-inline";
import { hasText } from "@/lib/text";

/** Glyph / shape family for the outline bullet (DESIGN-REFINE §2 W1). */
export type BulletKind =
  | "plain"
  | "parent"
  | "tag"
  | "field"
  | "query"
  | "command"
  | "media"
  | "canvas"
  | "ontology";

/** Optional overrides for canvas (and forced media) until those tags ship. */
type BulletKindOverride = "media" | "canvas";

export interface BulletModeInput {
  hasChildren: boolean;
  /** Values of `sys.f.type` ref props. */
  typeRefs: string[];
  /** Resolved tag badge names (lowercase compare). */
  tagNames: string[];
  /** Field-node ids this node carries a value for — the kind carriers. */
  fieldIds?: string[];
  /** True when node id starts with `sys.`. */
  isSys: boolean;
  /** Node text — used to detect `![…](assets/…)` media refs (W6a). */
  text?: string;
  /** Stub override for media/canvas kinds. */
  kindOverride?: BulletKindOverride | null;
}

/**
 * Map node metadata → bullet kind.
 * Priority: override → tag/field/command type → query field → canvas/ontology
 * type → media asset ref → parent → plain.
 */
export function resolveBulletKind(input: BulletModeInput): BulletKind {
  if (input.kindOverride === "media" || input.kindOverride === "canvas") {
    return input.kindOverride;
  }

  const refs = input.typeRefs;
  if (refs.includes(SYSTEM_IDS.tag)) return "tag";
  if (refs.includes(SYSTEM_IDS.field)) return "field";
  // W3: sys.command type node
  if (refs.includes(SYSTEM_IDS.command)) return "command";
  // W4: anything carrying sys.f.query — the field is the kind, so the glyph
  // reads the same carrier `isQueryNode` does instead of a tag's display name.
  if (input.fieldIds?.includes(SYSTEM_IDS.queryField) === true) return "query";
  // C1: #canvas tag (or seeded sys.tag.canvas)
  if (
    refs.includes(SYSTEM_IDS.canvasTag) ||
    input.tagNames.some((n) => n.toLowerCase() === "canvas")
  ) {
    return "canvas";
  }
  // r5: #ontology tag — a lens over the graph, not ordinary content
  if (
    refs.includes(SYSTEM_IDS.ontologyTag) ||
    input.tagNames.some((n) => n.toLowerCase() === "ontology")
  ) {
    return "ontology";
  }

  // W6a: ▣ when node text embeds an assets/ markdown image
  if (hasText(input.text) && textHasAssetRef(input.text)) return "media";

  if (input.hasChildren) return "parent";
  return "plain";
}

/**
 * The bullet's whole appearance, as one value: the one definition of what a
 * bullet shows.
 *
 * `Bullet` used to decide shape, halo, count badge, tint, title and
 * aria-label inside its own JSX, with its paints and sizes in class strings.
 * This record now carries all of it — what the bullet is, what paints each
 * surface, and how big each part is — so every renderer of a bullet draws
 * the same thing: the outline's `Bullet` in the DOM, and the graph's bullet
 * theme on a canvas (`lib/bullet-paint`). A renderer decides nothing.
 */
export type BulletShape = "supertag" | "query" | "ref-ring" | "glyph" | "dot";

/**
 * What paints one surface: the node's tag colours, dividing a filled surface
 * equally from the centre (a stroke or a glyph carries only the first), or
 * the ink when the node has no tag, each at a strength in percent.
 */
export interface BulletPaint {
  readonly colors: readonly string[];
  readonly percent: number;
}

/** The ink an untinted bullet is drawn in: the page's foreground. */
export const BULLET_INK = "var(--foreground)";

/**
 * A bullet's geometry, CSS pixels at density 1 (DESIGN-REFINE §2 W1): the
 * 24px box every mode shares, the halo inset from it, the dashed reference
 * ring, the query icon and the two dot sizes. Every part is sized from here,
 * so every renderer keeps the parts in proportion.
 */
export const BULLET_GEOMETRY = {
  box: 24,
  haloInset: 3,
  ring: 18,
  icon: 14,
  dot: { leaf: 4, parent: 5 },
} as const;

/** A kind glyph (# ⌗ ⚙ ▣ ◇ ⬡): set bold, at the label step of the UI face. */
export const BULLET_GLYPH = { size: "--type-label", weight: 700 } as const;

/**
 * The query bullet's glyph: Phosphor's bold magnifier (MagnifyingGlass,
 * `weight="bold"`), held here as the one path every renderer of a bullet
 * draws — in a box of `viewBox` units, `BULLET_GEOMETRY.icon` pixels wide.
 */
export const BULLET_QUERY_ICON = {
  viewBox: 256,
  path: "M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z",
} as const;

/** A `sys.*` bullet is drawn at this opacity. */
export const BULLET_SYS_OPACITY = 0.5;

export interface BulletAppearance {
  kind: BulletKind;
  shape: BulletShape;
  /** The kind's glyph, when it has one. `shape` decides whether it is used. */
  glyph: string | null;
  isSys: boolean;
  isRef: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  childCount: number;
  /** Whether clicking toggles. Overridable: a row's fields also count. */
  collapsible: boolean;
  showHalo: boolean;
  showCount: boolean;
  /** True when any tag contributed a color, i.e. the ink fallbacks are off. */
  tinted: boolean;
  /** The halo's fill (drawn only when `showHalo`). */
  halo: BulletPaint;
  /** The dot's fill (the plain dot, and the dot inside the reference ring). */
  dot: BulletPaint;
  /** The dot's diameter: a parent's is one pixel larger. */
  dotSize: number;
  /** A glyph's or the query icon's colour. */
  ink: BulletPaint;
  /** The dashed reference ring's stroke. */
  ring: BulletPaint;
  title: string;
  ariaLabel: string | undefined;
}

export interface BulletAppearanceInput extends BulletModeInput {
  collapsed: boolean;
  childCount: number;
  isRef?: boolean;
  /**
   * Overrides the derived affordance. `NodeBlock` passes it because a row's
   * fields are expandable content the bullet cannot see.
   */
  collapsible?: boolean;
  /** The node's resolved tag colors, in order (see lib/tag-color). */
  tagColors?: readonly string[];
}

/** DESIGN-RESKIN §1.3 — collapsed halo is the tag color at 12.5% (was `20`). */
const HALO_OPACITY = 12.5;
/** Dashed reference ring stroke at 25% (was `40`). */
const REF_RING_OPACITY = 25;
/** The ink's strength on each surface of an untinted bullet, in percent. */
const INK = {
  halo: 8,
  dot: { leaf: 40, parent: 50 },
  /** The dot inside a reference ring stands a little stronger on a parent. */
  ringDot: { leaf: 40, parent: 55 },
  glyph: { leaf: 45, parent: 55 },
  ring: 20,
} as const;

const KIND_GLYPH: Partial<Record<BulletKind, string>> = {
  tag: "#",
  field: "\u2317",
  command: "\u2699",
  media: "\u25A3",
  canvas: "\u25C7",
  ontology: "\u2B21",
};

/**
 * Which element the bullet is.
 *
 * The order is the one the JSX ternary encoded by position, and two of the
 * rungs are load-bearing: a supertag and a query node keep their own shape
 * *on a reference row*, while a glyph kind gives way to the dashed ring.
 */
function resolveBulletShape(kind: BulletKind, isRef: boolean, glyph: string | null): BulletShape {
  if (kind === "tag") return "supertag";
  if (kind === "query") return "query";
  if (isRef) return "ref-ring";
  if (hasText(glyph)) return "glyph";
  return "dot";
}

/** What the bullet promises when it is clicked. */
function resolveAriaLabel(
  collapsible: boolean,
  collapsed: boolean,
  hasChildren: boolean,
  childCount: number,
): string | undefined {
  if (!collapsible) return undefined;
  if (!collapsed) return "Collapse";
  return hasChildren ? `Expand (${childCount} children)` : "Expand results";
}

const inked = (percent: number): BulletPaint => ({ colors: [BULLET_INK], percent });

/**
 * The paints of a bullet's four surfaces. A tinted bullet fills with every
 * tag colour and strokes with the first; a kind glyph (⌗ ⚙ ▣ ◇ ⬡) is always
 * the ink, whatever the tags — it names the kind, not the tag.
 */
function resolvePaints(
  shape: BulletShape,
  tagColors: readonly string[],
  hasChildren: boolean,
): Pick<BulletAppearance, "halo" | "dot" | "ink" | "ring"> {
  const depth = hasChildren ? "parent" : "leaf";
  const first = tagColors.slice(0, 1);
  if (tagColors.length === 0) {
    return {
      halo: inked(INK.halo),
      dot: inked(shape === "ref-ring" ? INK.ringDot[depth] : INK.dot[depth]),
      ink: inked(shape === "supertag" ? INK.glyph[depth] : INK.glyph.leaf),
      ring: inked(INK.ring),
    };
  }
  return {
    halo: { colors: tagColors, percent: HALO_OPACITY },
    dot: { colors: tagColors, percent: 100 },
    ink: shape === "glyph" ? inked(INK.glyph.leaf) : { colors: first, percent: 100 },
    ring: { colors: first, percent: REF_RING_OPACITY },
  };
}

export function bulletAppearance(input: BulletAppearanceInput): BulletAppearance {
  const kind = resolveBulletKind(input);
  const glyph = KIND_GLYPH[kind] ?? null;
  const isRef = input.isRef ?? false;
  const collapsible = input.collapsible ?? (input.hasChildren || kind === "query");
  const showHalo = collapsible && input.collapsed;
  const shape = resolveBulletShape(kind, isRef, glyph);
  const tagColors = input.tagColors ?? [];

  return {
    kind,
    shape,
    glyph,
    isSys: input.isSys,
    isRef,
    hasChildren: input.hasChildren,
    collapsed: input.collapsed,
    childCount: input.childCount,
    collapsible,
    showHalo,
    showCount: showHalo && input.childCount > 0,
    tinted: tagColors.length > 0,
    ...resolvePaints(shape, tagColors, input.hasChildren),
    dotSize: input.hasChildren ? BULLET_GEOMETRY.dot.parent : BULLET_GEOMETRY.dot.leaf,
    title: collapsible ? "Click to toggle, Cmd+click to focus" : "Cmd+click to focus",
    ariaLabel: resolveAriaLabel(collapsible, input.collapsed, input.hasChildren, input.childCount),
  };
}

/** How a row draws the bullet beyond the node itself. */
export interface OutlineBulletOptions {
  /** True when node has children, fields, or is a query node. */
  readonly collapsible?: boolean;
  /** Reference-row state (query result / embedded ref) — dashed ring. */
  readonly isRef?: boolean;
  /** W6 stubs: force media/canvas glyph before those tags exist. */
  readonly kindOverride?: BulletKindOverride | null;
}

/**
 * The bullet of an outline node: what the outline's row draws, and what any
 * other view that shows the node as the outline does (the graph's bullet
 * theme) reads, from the same node.
 */
export function outlineBulletAppearance(
  node: OutlineNode,
  options: OutlineBulletOptions = {},
): BulletAppearance {
  return bulletAppearance({
    hasChildren: node.children.length > 0,
    typeRefs: typeRefsOf(node),
    tagNames: node.tags.map((t) => t.name),
    fieldIds: Object.keys(node.props),
    isSys: isSysPrefixed(node.id),
    text: node.text,
    kindOverride: options.kindOverride ?? null,
    collapsed: node.collapsed,
    childCount: node.children.length,
    isRef: options.isRef ?? false,
    ...(options.collapsible === undefined ? {} : { collapsible: options.collapsible }),
    tagColors: nodeTagColors(node),
  });
}

/**
 * A paint as one CSS `background`/`color` value: one colour at its strength,
 * or equal wedges of several (`tagColorFill`).
 */
export function bulletPaintCss(paint: BulletPaint): string {
  return tagColorFill(paint.colors, paint.percent) ?? "transparent";
}
