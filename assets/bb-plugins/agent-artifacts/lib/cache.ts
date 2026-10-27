// The promise cache server.ts shares between the panel, header chips and `bb artifacts`. Pure: tested in tests/.

/** Cache entries older than this are dropped on the next write, so threads visited once do not pile up. */
const EVICT_MS = 10 * 60_000;

/** A promise cache shared by every caller: in-flight work is joined, failures are not kept, old entries age out. */
export function promiseCache<T>(ttlMs: number) {
  const entries = new Map<string, { at: number; value: Promise<T>; settled: boolean }>();
  return {
    /**
     * The value for `key`. Within `ttlMs` (or while in flight) it is shared. Past it, `stale: "serve"` returns the old
     * value at once and refreshes behind it (calling `onRefreshed`); `stale: "wait"` waits for the new one. `fresh`
     * ignores the cached value but still joins work already in flight.
     */
    get(key: string, load: () => Promise<T>, opts: { fresh?: boolean; stale?: "serve" | "wait"; onRefreshed?: (value: T) => void } = {}): Promise<T> {
      const hit = entries.get(key);
      const now = Date.now();
      if (hit !== undefined && !hit.settled) return hit.value;
      if (hit !== undefined && !opts.fresh && now - hit.at < ttlMs) return hit.value;
      const start = () => {
        const value = load();
        const entry = { at: Date.now(), value, settled: false };
        for (const [k, e] of entries) if (e.settled && Date.now() - e.at > EVICT_MS) entries.delete(k);
        entries.set(key, entry);
        value.then(
          v => {
            entry.settled = true;
            opts.onRefreshed?.(v);
          },
          () => {
            if (entries.get(key) === entry) entries.delete(key);
          },
        );
        return value;
      };
      if (hit !== undefined && !opts.fresh && opts.stale === "serve") {
        const old = hit.value;
        start().catch(() => {});
        return old;
      }
      return start();
    },
    clear: () => entries.clear(),
  };
}
