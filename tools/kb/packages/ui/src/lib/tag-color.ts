/**
 * Tag color — DESIGN-RESKIN §1.8.
 *
 * This module owns three things, and nothing else may restate them:
 *
 * 1. **Which color a tag is** (`hashTagColor` / `resolveTagColor`).
 * 2. **Which colors a node carries** (`nodeTagColors`) — a *list*. Treating it
 *    as a scalar (`tags[0]?.color`) is what made a many-tagged bullet paint one
 *    tag; the reduction is gone from every call site.
 * 3. **How a tag color is weakened or divided** (`tagColorAlpha`,
 *    `tagColorFill`) — because an explicit `sys.f.color` prop comes back from
 *    `resolveTagColor` verbatim, so the value may be `red`, `#f00` or
 *    `oklch(…)`, and appending hex-alpha digits to those produces garbage.
 */
import type { TagBadge } from "@/lib/types";

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
  "#10b981",
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
  return TAG_PALETTE[index]!;
}

/** Explicit tag-node `color` prop overrides the hash. */
export function resolveTagColor(tagId: string, explicitColor?: string | null): string {
  const trimmed = explicitColor?.trim();
  if (trimmed) return trimmed;
  return hashTagColor(tagId);
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
  if (paints.length === 1) return paints[0]!;
  const step = 100 / paints.length;
  const wedges = paints.map((paint, i) => `${paint} ${stop(i * step)} ${stop((i + 1) * step)}`);
  return `conic-gradient(from 0deg, ${wedges.join(", ")})`;
}
