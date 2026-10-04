import { resolve } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { ScreenCapture, ScreenPicture } from "@kb/contracts";
import type { DomainError } from "@kb/model";
import { internal } from "./errors.ts";

/**
 * `.kb/captures/`: the pictures `ui.capture` had a tab draw, kept as PNG
 * files so a local agent can open them by path. Runtime state, like
 * `.kb/ui.json`: never committed, never backed up, and only the newest
 * {@link KEPT} are kept — a capture is looked at once, then it is stale.
 */
function capturesDir(root: string): string {
  return resolve(root, ".kb", "captures");
}

/** How many captures are kept; the oldest go as new ones come. */
const KEPT = 24;

/** A failed step of keeping a capture, said as what it was doing. */
const failed = (what: string) => (err: unknown) => internal(what, err);

/** Keep `picture` under `root`'s captures, as `name`.png, and answer where it is. */
export const keepCapture = Effect.fn("kb.captures.keep")(function* (
  root: string,
  name: string,
  picture: ScreenPicture,
): Effect.fn.Return<ScreenCapture, DomainError, FileSystem> {
  const fs = yield* FileSystem;
  const dir = capturesDir(root);
  const path = resolve(dir, `${name}.png`);

  yield* fs
    .makeDirectory(dir, { recursive: true })
    .pipe(Effect.mapError(failed("make .kb/captures")));
  yield* fs
    .writeFile(
      path,
      Uint8Array.from(atob(picture.data), (c) => c.charCodeAt(0)),
    )
    .pipe(Effect.mapError(failed("write a capture")));
  // Names sort by when they were made (ULIDs), so the oldest are the first.
  const names = (yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [])))
    .filter((file) => file.endsWith(".png"))
    .toSorted();
  for (const old of names.slice(0, Math.max(0, names.length - KEPT))) {
    yield* fs.remove(resolve(dir, old)).pipe(Effect.ignore);
  }
  return { mime: picture.mime, path, width: picture.width, height: picture.height };
});
