/**
 * What a picker's user picked lately, per picker, for this session — a
 * per-viewer convenience that orders an empty query (`orderCandidates`). It
 * is not graph state and is never stored: a new session starts from use
 * counts, which are the graph's.
 */
const RECENT_LIMIT = 8;
const recentByScope = new Map<string, string[]>();

/** Most recent first. */
export function recentPicks(scope: string): readonly string[] {
  return recentByScope.get(scope) ?? [];
}

export function notePick(scope: string, id: string): void {
  const next = [id, ...(recentByScope.get(scope) ?? []).filter((x) => x !== id)];
  recentByScope.set(scope, next.slice(0, RECENT_LIMIT));
}
