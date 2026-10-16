import { resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { ServerIdentitySchema } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";

/**
 * `.kb/ui.json`: which `kb ui` serves this root, while one does. The server
 * writes it once it listens and removes it when it stops; a process that
 * needs the server for its root (the CLI or MCP asking for the screen) reads
 * it. It is runtime state, like a pidfile: never committed, never backed up,
 * readable by its owner only. A file left by a server that died names a URL
 * that no longer answers, or that another root's server now answers, so a
 * reader asks the server which root it serves before it trusts the file.
 */
function uiPresenceFile(root: string): string {
  return resolve(root, ".kb", "ui.json");
}

const PresenceSchema = Schema.Struct({
  url: Schema.String,
  pid: Schema.Finite,
  root: Schema.String,
});
export type UiPresence = typeof PresenceSchema.Type;

const decodePresence = Schema.decodeUnknownOption(Schema.fromJsonString(PresenceSchema));

/** The root as a server names it: absolute, with its symlinks resolved. */
export const canonicalRoot = Effect.fn("kb.uiPresence.canonicalRoot")(function* (
  root: string,
): Effect.fn.Return<string, never, FileSystem> {
  const fs = yield* FileSystem;
  return yield* fs.realPath(root).pipe(Effect.orElseSucceed(() => resolve(root)));
});

/** Record that the `kb ui` at `url`, this process, serves `root`. */
export const writeUiPresence = Effect.fn("kb.uiPresence.write")(function* (
  root: string,
  url: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const file = uiPresenceFile(root);
  const presence: UiPresence = { url, pid: process.pid, root: yield* canonicalRoot(root) };
  yield* fs
    .writeFileString(file, `${JSON.stringify(presence)}\n`, { mode: 0o600 })
    // The mode applies only to a file this write creates; one left behind keeps its own.
    .pipe(
      Effect.andThen(fs.chmod(file, 0o600)),
      Effect.mapError((err) => internal("write .kb/ui.json", err)),
    );
});

/** What `.kb/ui.json` says, or null when there is none or it is not one this module wrote. */
export const readUiPresence = Effect.fn("kb.uiPresence.read")(function* (
  root: string,
): Effect.fn.Return<UiPresence | null, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const text = yield* fs
    .readFileString(uiPresenceFile(root))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.succeed(null) : Effect.fail(internal("read .kb/ui.json", err)),
      ),
    );
  if (text === null) return null;
  return Option.getOrNull(decodePresence(text));
});

/** How long the server named in `.kb/ui.json` gets to say which root it serves. */
const PROBE_MS = 500;

/**
 * The URL of the `kb ui` that serves `root` now, or null. The presence file
 * only says where one was: the server there is asked which root it serves,
 * briefly, and anything short of this root's own answer (no file, nothing
 * listening, too slow, another root) means no server.
 */
export const servingUi = Effect.fn("kb.uiPresence.serving")(function* (
  root: string,
): Effect.fn.Return<string | null, DomainError, FileSystem> {
  const presence = yield* readUiPresence(root);
  if (presence === null) return null;
  const expected = yield* canonicalRoot(root);
  const identity = yield* Effect.tryPromise((signal) =>
    fetch(`${presence.url}/api/identity`, { signal }),
  ).pipe(
    Effect.flatMap((res) => Effect.tryPromise(() => res.json())),
    Effect.map((body) => ServerIdentitySchema.safeParse(body)),
    Effect.timeoutOption(PROBE_MS),
    Effect.orElseSucceed(() => Option.none()),
  );
  if (Option.isNone(identity) || !identity.value.success) return null;
  return identity.value.data.root === expected ? presence.url : null;
});

/**
 * Forget that the `kb ui` at `url` serves `root`: remove the file, unless a
 * later server over the same root has since written its own.
 */
export const clearUiPresence = Effect.fn("kb.uiPresence.clear")(function* (
  root: string,
  url: string,
): Effect.fn.Return<void, DomainError, FileSystem> {
  if ((yield* readUiPresence(root))?.url !== url) return;
  const fs = yield* FileSystem;
  yield* fs
    .remove(uiPresenceFile(root))
    .pipe(
      Effect.catch((err) =>
        isNotFound(err) ? Effect.void : Effect.fail(internal("remove .kb/ui.json", err)),
      ),
    );
});
