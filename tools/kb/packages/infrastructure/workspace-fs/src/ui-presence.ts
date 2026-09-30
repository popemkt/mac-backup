import { resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/**
 * `.kb/ui.json`: which `kb ui` serves this root, while one does. The server
 * writes it once it listens and removes it when it stops; a process that
 * needs the server for its root (the CLI or MCP asking for the screen) reads
 * it. It is runtime state, like a pidfile: never committed, never backed up,
 * and a file left by a server that died is only a URL nothing answers on.
 */
function uiPresenceFile(root: string): string {
  return resolve(root, ".kb", "ui.json");
}

// The file names a URL and nothing that proves which root is served there.
// GAP [GAP-UI-PRESENCE-IDENTITY]
const Presence = Schema.fromJsonString(Schema.Struct({ url: Schema.String }));
const decodePresence = Schema.decodeUnknownOption(Presence);

/** Record that the `kb ui` at `url` serves `root`. */
export const writeUiPresence = Effect.fn("kb.uiPresence.write")(function* (
  root: string,
  url: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  yield* fs
    .writeFileString(uiPresenceFile(root), `${JSON.stringify({ url })}\n`)
    .pipe(Effect.mapError((err) => internal("write .kb/ui.json", err)));
});

/** The URL of the `kb ui` serving `root`, or null when none says it does. */
export const readUiPresence = Effect.fn("kb.uiPresence.read")(function* (
  root: string,
): Effect.fn.Return<string | null, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const text = yield* fs
    .readFileString(uiPresenceFile(root))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.succeed(null) : Effect.fail(internal("read .kb/ui.json", err)),
      ),
    );
  if (text === null) return null;
  // A file that is not one this module wrote names no server.
  return Option.getOrNull(Option.map(decodePresence(text), (presence) => presence.url));
});

/**
 * Forget that the `kb ui` at `url` serves `root`: remove the file, unless a
 * later server over the same root has since written its own.
 */
export const clearUiPresence = Effect.fn("kb.uiPresence.clear")(function* (
  root: string,
  url: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  if ((yield* readUiPresence(root)) !== url) return;
  const fs = yield* FileSystem;
  yield* fs
    .remove(uiPresenceFile(root))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.void : Effect.fail(internal("remove .kb/ui.json", err)),
      ),
    );
});
