import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Views } from "@kb/contracts";
import { domainError, type DomainError } from "@kb/model";
import { internal, isNotFound } from "./errors.ts";
import { resolveViewFile, stemOf, viewsDir } from "./paths.ts";

const EXT = ".json";

function pathOf(root: string, name: string): Effect.Effect<string, DomainError> {
  const path = resolveViewFile(root, name);
  if (path === null) {
    return domainError("invalid_input", `invalid view name: ${name}`, { name });
  }
  return Effect.succeed(path);
}

/** `.kb/views/<name>.json` on a FileSystem. */
export function viewsLayer(root: string): Layer.Layer<Views, never, FileSystem> {
  return Layer.effect(
    Views,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = viewsDir(root);

      return Views.of({
        list: fs.readDirectory(dir).pipe(
          Effect.orElseSucceed((): string[] => []),
          Effect.map((entries) =>
            entries
              .map((entry) => stemOf(entry, EXT))
              .filter(
                (name): name is string => name !== null && resolveViewFile(root, name) !== null,
              )
              .toSorted(),
          ),
        ),
        load: Effect.fn("kb.views.load")(function* (name: string) {
          const path = yield* pathOf(root, name);
          return yield* fs
            .readFileString(path)
            .pipe(
              Effect.catch((err) =>
                isNotFound(err)
                  ? Effect.succeed(null)
                  : Effect.fail(internal(`read view ${name}`, err)),
              ),
            );
        }),
      });
    }),
  );
}
