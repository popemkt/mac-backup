import { SYSTEM_IDS } from "@/lib/types";
import { tagColorAlpha, tagColorFill } from "@/lib/tag-color";
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
export type BulletKindOverride = "media" | "canvas";

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
 * The bullet's whole appearance, as one value.
 *
 * `Bullet` used to decide shape, halo, count badge, tint, title and
 * aria-label inside its own JSX — a nested ternary for the element and three
 * `!tinted && …` class strings around it, which made the single most-read
 * affordance in the outline untestable without rendering. The component now
 * renders this record and decides nothing.
 */
export type BulletShape = "supertag" | "query" | "ref-ring" | "glyph" | "dot";

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
  /** True when any tag contributed a color, i.e. the fallback tints are off. */
  tinted: boolean;
  /** Filled surfaces divide every tag color equally from the center. */
  haloFill: string | null;
  dotFill: string | null;
  /** A stroke or a glyph can only carry one color, so it takes the first. */
  strokeColor: string | null;
  ringColor: string | null;
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

export function bulletAppearance(input: BulletAppearanceInput): BulletAppearance {
  const kind = resolveBulletKind(input);
  const glyph = KIND_GLYPH[kind] ?? null;
  const isRef = input.isRef ?? false;
  const collapsible = input.collapsible ?? (input.hasChildren || kind === "query");
  const showHalo = collapsible && input.collapsed;

  const tagColors = input.tagColors ?? [];
  const strokeColor = tagColors[0] ?? null;

  return {
    kind,
    shape: resolveBulletShape(kind, isRef, glyph),
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
    haloFill: tagColorFill(tagColors, HALO_OPACITY),
    dotFill: tagColorFill(tagColors),
    strokeColor,
    ringColor: strokeColor === null ? null : tagColorAlpha(strokeColor, REF_RING_OPACITY),
    title: collapsible ? "Click to toggle, Cmd+click to focus" : "Cmd+click to focus",
    ariaLabel: resolveAriaLabel(collapsible, input.collapsed, input.hasChildren, input.childCount),
  };
}
