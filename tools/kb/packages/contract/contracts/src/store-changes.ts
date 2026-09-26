import { Effect, Queue, Stream } from "effect";
import type { StoreFingerprint } from "./store.ts";

/** The part of a platform directory watcher this module uses. */
export interface DirectoryWatcher {
  close(): void;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * Open a watch on one directory. `node:fs`'s `watch` is one; the parameter is
 * how a `scope:shared` module gets a platform capability without importing it.
 */
export type WatchDirectory = (
  directory: string,
  listener: (event: string, filename: string | null) => void,
) => DirectoryWatcher;

/**
 * One watched directory, and the filenames in it that matter — `null` when the
 * whole directory is the target.
 *
 * Directories rather than files because an atomic replacement strands a watch
 * on the old inode, so `nodes.jsonl` is watched as "the name `nodes.jsonl` in
 * `.kb`".
 */
export interface WatchScope {
  readonly directory: string;
  readonly names: ReadonlySet<string> | null;
}

/**
 * A tick once the watches are armed, then one each time something in a
 * watched scope moves. Best effort per directory: one that cannot be watched
 * contributes nothing. The buffer holds one pending tick, so a burst that
 * lands while the consumer is busy is seen once, after it.
 *
 * The first tick is what makes "armed" observable: anything that happened
 * before it is the consumer's starting state, anything after it produces a
 * tick of its own.
 */
export function directorySignals(
  scopes: readonly WatchScope[],
  watch: WatchDirectory,
): Stream.Stream<void> {
  return Stream.callback<void>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const signal = (): void => {
            Queue.offerUnsafe(queue, undefined);
          };
          const watchers: DirectoryWatcher[] = [];
          for (const { directory, names } of scopes) {
            try {
              const watcher = watch(directory, (_event, filename) => {
                if (names === null || filename === null || filename === "" || names.has(filename)) {
                  signal();
                }
              });
              watcher.on("error", () => {
                /* A transient filesystem error must not end the stream. */
              });
              watchers.push(watcher);
            } catch {
              /* Best effort for an unavailable directory. */
            }
          }
          signal();
          return watchers;
        }),
        (watchers) =>
          Effect.sync(() => {
            for (const watcher of watchers) watcher.close();
          }),
      ),
    { bufferSize: 1, strategy: "sliding" },
  );
}

/**
 * {@link EffectStore.changes} for a store whose state lives in files: sample
 * the fingerprint on every signal and pass on the ones that differ from the
 * last. The one implementation both file-backed adapters use, so what the port
 * promises about external writes cannot come true for one backend and not the
 * other.
 */
export function fingerprintChanges(options: {
  readonly scopes: readonly WatchScope[];
  readonly watch: WatchDirectory;
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
}): Stream.Stream<StoreFingerprint | null> {
  return directorySignals(options.scopes, options.watch).pipe(
    Stream.mapEffect(() => options.fingerprint),
    Stream.changes,
  );
}
