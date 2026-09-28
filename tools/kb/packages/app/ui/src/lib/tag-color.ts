/**
 * Tag color — DESIGN-RESKIN §1.8.
 *
 * This module owns three things, and nothing else may restate them:
 *
 * 1. **Which color a tag is** (`tagPalette` over the whole workspace, read
 *    through `tagColorOf`): its explicit `sys.f.color`
 *    prop, else its palette slot, chosen so tags in use do not collide; and
 *    what no tag paints (`UNTAGGED_COLOR`).
 * 2. **Which colors a node carries** (`nodeTagColors`) — a *list*. Treating it
 *    as a scalar (`tags[0]?.color`) is what made a many-tagged bullet paint one
 *    tag; the reduction is gone from every call site.
 * 3. **How a tag color is weakened, divided or inked** (`tagColorAlpha`,
 *    `tagColorFill`, `tagInk`, `tagChipColors`) — because an explicit `sys.f.color` prop comes back from
 *    `tagColorOf` verbatim, so the value may be `red`, `#f00` or
 *    `oklch(…)`, and appending hex-alpha digits to those produces garbage.
 * 4. **Which ink a reference to a node wears in text** (`refInkOf`): its
 *    target's first tag colour, inked as a chip's text is.
 */
import type { WireNode } from "@kb/contracts";
import { present, typeRefsOf } from "@kb/model";
import type { RefInk } from "@/lib/md-edit";
import type { SchemaIndex } from "@/lib/schema";
import { hasText } from "@/lib/text";
import { SYSTEM_IDS, type TagBadge } from "@/lib/types";

/** Deterministic 12-color hash (djb2 % 12). */
export const TAG_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#6366f1",
  "#84cc16",
] as const;

/** Signed djb2 — matches nxus `hashString` (no unsigned coercion). */
export function djb2Hash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash;
}

export function hashTagColor(tagId: string): string {
  const index = Math.abs(djb2Hash(tagId)) % TAG_PALETTE.length;
  return present(TAG_PALETTE[index], "tag palette index is a modulo of its length");
}

/** The `sys.f.color` a tag node sets for itself, trimmed — any CSS colour — or null. */
function explicitColorOf(tag: Pick<WireNode, "props"> | undefined): string | null {
  const raw = tag?.props[SYSTEM_IDS.colorField]?.[0];
  const color = raw?.t === "str" ? raw.v.trim() : "";
  return hasText(color) ? color : null;
}

/**
 * The colour an option of a field paints its chip with: its own `sys.f.color`
 * when it sets one, else the palette slot of its place among the field's
 * options — so a field's options start out distinct, in the order the field
 * lists them, the way a workspace's tags do.
 */
export function optionColorOf(
  option: Pick<WireNode, "id" | "props">,
  field: Pick<WireNode, "children"> | undefined,
): string {
  const explicit = explicitColorOf(option);
  if (explicit !== null) return explicit;
  const place = field?.children.indexOf(option.id) ?? -1;
  if (place < 0) return hashTagColor(option.id);
  return present(TAG_PALETTE[place % TAG_PALETTE.length], "a slot is an index into the palette");
}

/**
 * What a node with no tag paints: a neutral grey, not a palette slot, so
 * "untagged" never reads as one more tag (it used to hash onto `canvas`'s
 * indigo). Mid-lightness, so it holds up on a light and a dark ground.
 */
export const UNTAGGED_COLOR = "#8e8e93";

const isTag = (node: WireNode): boolean => typeRefsOf(node).includes(SYSTEM_IDS.tag);

/** Oldest first, so a new tag only ever takes a free slot and never moves an old one. */
const byAge = (a: WireNode, b: WireNode): number =>
  a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1;

/** The colour of every tag in a workspace, by tag id. */
export type TagPalette = ReadonlyMap<string, string>;

/** The workspace graph a palette is computed from: its wire nodes, as a list or by id. */
type WorkspaceGraph = readonly WireNode[] | ReadonlyMap<string, WireNode>;

const palettes = new WeakMap<WorkspaceGraph, TagPalette>();

/**
 * The colour of every tag in the workspace — a pure function of the whole
 * graph, and the one map every projection reads.
 *
 * A tag's explicit `sys.f.color` wins. Otherwise it starts at its hash slot
 * and, when an older tag already holds it, takes the next free one, so two
 * tags never share a colour while the palette has room; an explicit colour
 * that is a palette entry holds its slot first. Past twelve tags every slot
 * is taken, and a tag takes the least-used slot from its hash onward.
 *
 * Always pass the **whole** workspace graph, never a projection of it (an
 * ontology scope, a query's rows): the slots depend on which tags exist, so a
 * subset would repaint tags that lost a neighbour. Memoized per graph object,
 * which the store replaces whenever the graph changes.
 */
export function tagPalette(graph: WorkspaceGraph): TagPalette {
  const cached = palettes.get(graph);
  if (cached) return cached;
  const nodes = Array.isArray(graph) ? graph : [...graph.values()];
  const used: number[] = TAG_PALETTE.map(() => 0);
  const palette = new Map<string, string>();
  const hashed: WireNode[] = [];
  for (const node of nodes) {
    if (!isTag(node)) continue;
    const explicit = explicitColorOf(node);
    if (explicit === null) {
      hashed.push(node);
      continue;
    }
    palette.set(node.id, explicit);
    const held = TAG_PALETTE.findIndex((entry) => entry === explicit.toLowerCase());
    if (held >= 0) used[held] = (used[held] ?? 0) + 1;
  }
  for (const node of hashed.toSorted(byAge)) {
    const start = Math.abs(djb2Hash(node.id)) % TAG_PALETTE.length;
    let best = start;
    for (let step = 1; step < TAG_PALETTE.length; step++) {
      const slot = (start + step) % TAG_PALETTE.length;
      if ((used[slot] ?? 0) < (used[best] ?? 0)) best = slot;
    }
    used[best] = (used[best] ?? 0) + 1;
    palette.set(node.id, present(TAG_PALETTE[best], "a slot is an index into the palette"));
  }
  palettes.set(graph, palette);
  return palette;
}

/**
 * The colour tag `tagId` paints, from the workspace's palette; an id the
 * workspace does not hold as a tag falls back to its hash.
 */
export function tagColorOf(tagId: string, palette: TagPalette): string {
  return palette.get(tagId) ?? hashTagColor(tagId);
}

/**
 * The colors a node's tags carry, in tag order.
 *
 * Distinct colors only: two tags that resolve to the same palette entry say
 * nothing more than one, and collapsing them keeps a same-colored multi-tag
 * node rendering exactly like a single-tag one.
 */
export function nodeTagColors(node: { tags: readonly TagBadge[] } | null | undefined): string[] {
  if (!node) return [];
  const colors = new Set<string>();
  for (const tag of node.tags) {
    const color = tag.color.trim();
    if (color) colors.add(color);
  }
  return [...colors];
}

/**
 * `color` weakened to `percent` opacity.
 *
 * `color-mix` and not `` `${color}20` ``: hex-alpha concatenation only works on
 * a 6-digit hex, and an explicit tag color is whatever the user typed.
 */
export function tagColorAlpha(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

/** How strongly a tag chip's ground takes its tag colour, in percent. */
const TAG_CHIP_TINT = 10;

/**
 * The one paint of a tag chip: a faint tint of the tag colour for its ground,
 * and for its ink the tag colour moved toward `--foreground` by
 * `--tag-ink-mix`. The raw colour as text on its own tint fails AA on every
 * light ground (1.7:1 at worst), and a tag colour is data, so no one colour
 * could be picked for it; the mix darkens it on a light ground and lightens
 * it on a dark one, and each design system sets the amount that keeps the
 * whole palette at 4.5:1 or better (`lib/design-systems.test.ts`).
 */
export function tagChipColors(color: string): { backgroundColor: string; color: string } {
  return { backgroundColor: tagColorAlpha(color, TAG_CHIP_TINT), color: tagInk(color) };
}

/**
 * A tag colour as text: moved toward `--foreground` by `--tag-ink-mix`, the
 * amount each design system sets so the palette reads at 4.5:1 or better
 * (see `tagChipColors`, whose ink this is).
 */
function tagInk(color: string): string {
  return `color-mix(in oklab, ${color}, var(--foreground) var(--tag-ink-mix))`;
}

const refInks = new WeakMap<SchemaIndex, RefInk>();

/**
 * How references into `schema` are inked in text (`RefInk`): a reference to
 * a tagged node wears its first tag's colour (Tana's), and one to an
 * untagged or missing node the default link colour. One function per schema,
 * so a memo keyed on it survives until the graph changes.
 */
export function refInkOf(schema: SchemaIndex): RefInk {
  const cached = refInks.get(schema);
  if (cached !== undefined) return cached;
  const ink: RefInk = (id) => {
    const [color] = nodeTagColors(schema.get(id));
    return color === undefined ? null : tagInk(color);
  };
  refInks.set(schema, ink);
  return ink;
}

/** Trim float noise out of generated gradient stops (100/3 → `33.333%`). */
function stop(value: number): string {
  return `${Math.round(value * 1000) / 1000}%`;
}

/**
 * One CSS `background` value painting a round surface with a node's tag colors:
 * a single color fills it solid, several divide it into equal wedges from the
 * center (Tana's multicolor bullet). `null` when the node carries no tags, so
 * the caller keeps its untagged fallback.
 *
 * Only *filled* surfaces can take this. A stroke or a glyph carries one color;
 * those callers read `nodeTagColors(...)[0]`.
 */
export function tagColorFill(colors: readonly string[], opacityPercent = 100): string | null {
  if (colors.length === 0) return null;
  const paints =
    opacityPercent >= 100 ? colors : colors.map((color) => tagColorAlpha(color, opacityPercent));
  const [onlyPaint] = paints;
  if (paints.length === 1 && onlyPaint !== undefined) return onlyPaint;
  const step = 100 / paints.length;
  const wedges = paints.map((paint, i) => `${paint} ${stop(i * step)} ${stop((i + 1) * step)}`);
  return `conic-gradient(from 0deg, ${wedges.join(", ")})`;
}
