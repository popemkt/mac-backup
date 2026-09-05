import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { SavedQueries, type SavedQuery } from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";
import { queriesDir, resolveSavedQueryFile, stemOf } from "./paths.ts";

const EXT = ".edn";

function pathOf(root: string, name: string): Effect.Effect<string, DomainError> {
  const path = resolveSavedQueryFile(root, name);
  if (path === null) {
    return domainError(
      "invalid_input",
      `invalid saved query name: ${name} (letters, digits, ., _, - only)`,
      { name },
    );
  }
  return Effect.succeed(path);
}

/** `.kb/queries/<name>.edn` on a FileSystem. */
export function savedQueriesLayer(root: string): Layer.Layer<SavedQueries, never, FileSystem> {
  return Layer.effect(
    SavedQueries,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = queriesDir(root);

      const read = Effect.fn("kb.savedQueries.read")(function* (name: string) {
        const path = yield* pathOf(root, name);
        return yield* fs
          .readFileString(path)
          .pipe(
            Effect.catch((err) =>
              isNotFound(err)
                ? Effect.succeed(null)
                : Effect.fail(internal(`read saved query ${name}`, err)),
            ),
          );
      });

      return SavedQueries.of({
        list: Effect.gen(function* () {
          const entries = yield* fs
            .readDirectory(dir)
            .pipe(Effect.orElseSucceed((): string[] => []));
          const out: SavedQuery[] = [];
          for (const entry of entries) {
            const name = stemOf(entry, EXT);
            const path = name === null ? null : resolveSavedQueryFile(root, name);
            // A stem this port could never address is not a saved query, and a
            // directory named `x.edn` must not brick the listing.
            if (name === null || path === null) continue;
            const edn = yield* Effect.gen(function* () {
              const info = yield* fs.stat(path);
              if (info.type !== "File") return null;
              return yield* fs.readFileString(path);
            }).pipe(Effect.orElseSucceed(() => null));
            if (edn === null) continue;
            out.push({ name, edn });
          }
          return out.toSorted((a, b) => a.name.localeCompare(b.name));
        }),
        read,
      });
    }),
  );
}
