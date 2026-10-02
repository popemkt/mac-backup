import { Effect, Layer, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { LegacyDocsViews, type LegacyDocsViewFiles } from "@kb/contracts";
import type { DocsViewSpec, LegacyDocsView } from "@kb/model";
import { internal } from "./errors.ts";
import { resolveViewFile, stemOf, viewsDir } from "./paths.ts";

const EXT = ".json";

/**
 * What a legacy `.kb/views/<name>.json` held: an output, a template, and
 * exactly one of an inline query or a saved query's name.
 */
const LegacySpecSchema = Schema.Struct({
  output: Schema.NonEmptyString,
  template: Schema.NonEmptyString,
  query: Schema.optionalKey(Schema.NonEmptyString),
  savedQuery: Schema.optionalKey(Schema.NonEmptyString),
});
const decodeSpec = Schema.decodeUnknownOption(Schema.fromJsonString(LegacySpecSchema));

/** The spec a file's text holds, or why it holds none a docs view can carry. */
function specOf(raw: string): DocsViewSpec | string {
  const decoded = decodeSpec(raw);
  if (Option.isNone(decoded)) return "it is not a spec kb can read";
  const { output, template, query, savedQuery } = decoded.value;
  if (query !== undefined && savedQuery === undefined) return { output, template, query };
  if (savedQuery !== undefined && query === undefined) return { output, template, savedQuery };
  return "it names both a query and a saved query, or neither";
}

/**
 * The docs view specs a root still keeps as `.kb/views/*.json`, from before
 * docs views were view nodes, and a line for each one left out. A root with
 * no such directory keeps none. What `views.migrate` imports, and what
 * opening reports without importing. GAP [[01M3YM5YCHGX6S04KN4G75B9RF]]
 */
export const readLegacyDocsViews = Effect.fn("kb.views.legacy")(function* (root: string) {
  const fs = yield* FileSystem;
  const entries = yield* fs
    .readDirectory(viewsDir(root))
    .pipe(Effect.orElseSucceed((): string[] => []));
  const names = entries
    .map((entry) => stemOf(entry, EXT))
    .filter((name): name is string => name !== null)
    .toSorted((a, b) => a.localeCompare(b));
  const views: LegacyDocsView[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    const path = resolveViewFile(root, name);
    if (path === null) {
      skipped.push(`.kb/views/${name}.json is not a docs view name`);
      continue;
    }
    const raw = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    const spec = specOf(raw);
    if (typeof spec === "string") skipped.push(`.kb/views/${name}.json was not imported: ${spec}`);
    else views.push({ name, spec });
  }
  const files: LegacyDocsViewFiles = { views, skipped };
  return files;
});

/** `.kb/views/<name>.json` on a FileSystem, as the legacy port reads and retires it. */
export function legacyDocsViewsLayer(
  root: string,
): Layer.Layer<LegacyDocsViews, never, FileSystem> {
  return Layer.effect(
    LegacyDocsViews,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      return LegacyDocsViews.of({
        read: readLegacyDocsViews(root).pipe(Effect.provideService(FileSystem, fs)),
        retire: Effect.fn("kb.views.retire")(function* (names: readonly string[]) {
          for (const name of names) {
            const path = resolveViewFile(root, name);
            if (path === null) continue;
            yield* fs
              .remove(path)
              .pipe(Effect.mapError((err) => internal(`retire .kb/views/${name}.json`, err)));
          }
          const left = yield* fs
            .readDirectory(viewsDir(root))
            .pipe(Effect.orElseSucceed((): string[] => []));
          if (names.length > 0 && left.length === 0)
            yield* fs.remove(viewsDir(root), { recursive: true }).pipe(Effect.ignore);
        }),
      });
    }),
  );
}
