import { Duration, Effect, Queue, Stream } from "effect";
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
export type WatchDirectory = (directory: string, listener: () => void) => DirectoryWatcher;

/**
 * A tick once the watches are armed, then one each time anything in a watched
 * directory moves. Best effort per directory: one that cannot be watched
 * contributes nothing. The buffer holds one pending tick, so a burst that
 * lands while the consumer is busy is seen once, after it.
 *
 * The first tick is what makes "armed" observable: anything that happened
 * before it is the consumer's starting state, anything after it produces a
 * tick of its own.
 *
 * A tick says only "something here moved", never what. Directories rather
 * than files because an atomic replacement strands a watch on the old inode;
 * and no filename filter inside them, because the name an event carries does
 * not say which file changed — on macOS a rename is reported under its source
 * name, so the `tmp` → `nodes.jsonl` replace that ends every JSONL commit
 * arrives as the temp file, and a burst coalesces to whichever single name
 * the platform picked. Deciding whether the store moved is the sampler's job.
 */
export function directorySignals(
  directories: readonly string[],
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
          for (const directory of directories) {
            try {
              const watcher = watch(directory, signal);
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
 * The longest a commit by another instance can go unannounced on
 * {@link EffectStore.changes}: the fingerprint is also sampled on this
 * interval, whatever the platform reported.
 *
 * Events alone cannot carry the promise. A write through a file descriptor
 * that stays open produces no watch event at all on macOS, and that is exactly
 * how a long-lived sqlite connection writes its WAL — another `kb ui`, an MCP
 * server — so a store that trusted events would miss a writer for as long as
 * it lived. Events keep the common case prompt; the poll is the bound. A
 * sample is one fingerprint read (a counter on sqlite, a hash of one file on
 * JSONL), so the bound is cheap to keep.
 */
export const STORE_CHANGES_POLL = Duration.seconds(1);

/**
 * {@link EffectStore.changes} for a store whose state lives in files: sample
 * the fingerprint on every signal from the directories that hold them and on
 * every {@link STORE_CHANGES_POLL}, and pass on the ones that differ from the
 * last. The one implementation both file-backed adapters use, so what the port
 * promises about external writes cannot come true for one backend and not the
 * other — and because the fingerprint decides, a directory's unrelated traffic
 * (a lock, a backup, a saved query) costs a sample and never an announcement.
 */
export function fingerprintChanges(options: {
  readonly directories: readonly string[];
  readonly watch: WatchDirectory;
  readonly fingerprint: Effect.Effect<StoreFingerprint | null>;
}): Stream.Stream<StoreFingerprint | null> {
  // The tick's immediate first element is dropped: the armed signal is the
  // directory watch's, so the first sample is taken once the watch is open.
  const poll = Stream.tick(STORE_CHANGES_POLL).pipe(Stream.drop(1));
  return directorySignals(options.directories, options.watch).pipe(
    Stream.merge(poll),
    Stream.mapEffect(() => options.fingerprint),
    Stream.changes,
  );
}
