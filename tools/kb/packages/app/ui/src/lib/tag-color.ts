/**
 * Tag color — DESIGN-RESKIN §1.8.
 *
 * This module owns three things, and nothing else may restate them:
 *
 * 1. **Which color a tag is** (`tagColorOf`): its explicit `sys.f.color`
 *    prop, else its palette slot, chosen so tags in use do not collide; and
 *    what no tag paints (`UNTAGGED_COLOR`).
 * 2. **Which colors a node carries** (`nodeTagColors`) — a *list*. Treating it
 *    as a scalar (`tags[0]?.color`) is what made a many-tagged bullet paint one
 *    tag; the reduction is gone from every call site.
 * 3. **How a tag color is weakened or divided** (`tagColorAlpha`,
 *    `tagColorFill`) — because an explicit `sys.f.color` prop comes back from
 *    `tagColorOf` verbatim, so the value may be `red`, `#f00` or
 *    `oklch(…)`, and appending hex-alpha digits to those produces garbage.
 */
import type { WireNode } from "@kb/contracts";
import { present, typeRefsOf } from "@kb/model";
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
function explicitColorOf(tag: WireNode | undefined): string | null {
  const raw = tag?.props[SYSTEM_IDS.colorField]?.[0];
  const color = raw?.t === "str" ? raw.v.trim() : "";
  return hasText(color) ? color : null;
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

/**
 * The palette slot of every tag in one graph.
 *
 * A tag starts at its hash slot and, when another tag already holds it, takes
 * the next free one, so two tags in use never share a colour while the
 * palette has room. Explicit colours that are palette entries hold their slot
 * first. Past twelve tags every slot is taken, and a tag takes the least-used
 * slot from its hash onward. Memoized per graph map: the map is rebuilt when
 * the graph changes, and read many times per build.
 */
const slotsByGraph = new WeakMap<ReadonlyMap<string, WireNode>, ReadonlyMap<string, string>>();

function paletteSlots(byId: ReadonlyMap<string, WireNode>): ReadonlyMap<string, string> {
  const cached = slotsByGraph.get(byId);
  if (cached) return cached;
  const used: number[] = TAG_PALETTE.map(() => 0);
  const hashed: WireNode[] = [];
  for (const node of byId.values()) {
    if (!isTag(node)) continue;
    const explicit = explicitColorOf(node)?.toLowerCase() ?? null;
    if (explicit === null) hashed.push(node);
    else {
      const held = TAG_PALETTE.findIndex((entry) => entry === explicit);
      if (held >= 0) used[held] = (used[held] ?? 0) + 1;
    }
  }
  const slots = new Map<string, string>();
  for (const node of hashed.toSorted(byAge)) {
    const start = Math.abs(djb2Hash(node.id)) % TAG_PALETTE.length;
    let best = start;
    for (let step = 1; step < TAG_PALETTE.length; step++) {
      const slot = (start + step) % TAG_PALETTE.length;
      if ((used[slot] ?? 0) < (used[best] ?? 0)) best = slot;
    }
    used[best] = (used[best] ?? 0) + 1;
    slots.set(node.id, present(TAG_PALETTE[best], "a slot is an index into the palette"));
  }
  slotsByGraph.set(byId, slots);
  return slots;
}

/**
 * The colour tag `tagId` paints in the graph `byId`: its explicit prop, else
 * its palette slot among the graph's tags, else (an id the graph does not
 * hold as a tag) its hash.
 */
export function tagColorOf(tagId: string, byId: ReadonlyMap<string, WireNode>): string {
  return explicitColorOf(byId.get(tagId)) ?? paletteSlots(byId).get(tagId) ?? hashTagColor(tagId);
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
