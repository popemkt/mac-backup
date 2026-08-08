/** DESIGN-RESKIN §1.8 — deterministic 12-color hash (djb2 % 12). */
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
export function resolveTagColor(
  tagId: string,
  explicitColor?: string | null,
): string {
  const trimmed = explicitColor?.trim();
  if (trimmed) return trimmed;
  return hashTagColor(tagId);
}
