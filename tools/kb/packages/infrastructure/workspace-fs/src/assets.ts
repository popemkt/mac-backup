import { Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Assets } from "@kb/contracts";
import { domainError } from "@kb/model";
import { internal } from "./errors.ts";
import { ASSETS_URL_PREFIX, assetsDir, resolveAssetFile } from "./paths.ts";

/** `.kb/assets/<id>.<ext>` on a FileSystem. */
export function assetsLayer(root: string): Layer.Layer<Assets, never, FileSystem> {
  return Layer.effect(
    Assets,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = assetsDir(root);

      return Assets.of({
        write: Effect.fn("kb.assets.write")(function* (id: string, ext: string, bytes: Uint8Array) {
          const relPath = `${ASSETS_URL_PREFIX}${id}.${ext}`;
          const abs = resolveAssetFile(root, relPath);
          if (abs === null) {
            return yield* domainError("forbidden", "refusing to write outside assets dir", {
              id,
              ext,
            });
          }
          yield* fs
            .makeDirectory(dir, { recursive: true })
            .pipe(Effect.mapError((err) => internal(`create ${dir}`, err)));
          yield* fs
            .writeFile(abs, bytes)
            .pipe(Effect.mapError((err) => internal(`write asset ${relPath}`, err)));
          return relPath;
        }),
      });
    }),
  );
}
