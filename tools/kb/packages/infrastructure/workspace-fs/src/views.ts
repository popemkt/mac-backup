import { Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import type { LegacyDocsView } from "@kb/model";
import { resolveViewFile, stemOf, viewsDir } from "./paths.ts";

const EXT = ".json";

/** What a legacy `.kb/views/<name>.json` held that a docs view node can carry. */
const LegacySpecSchema = Schema.Struct({
  output: Schema.NonEmptyString,
  query: Schema.NonEmptyString,
  template: Schema.NonEmptyString,
});
const decodeSpec = Schema.decodeUnknownOption(Schema.fromJsonString(LegacySpecSchema));

/**
 * The docs view specs a root still keeps as `.kb/views/*.json`, from before
 * docs views were view nodes: what opening the store imports
 * (`migrateToViewNodes`), after which the files have nothing left to say. A
 * spec the import cannot carry — unreadable, or naming a saved query instead
 * of its own — is not returned. A root with no such directory has none.
 * GAP [GAP-LEGACY-DOCS-VIEWS-IMPORT]
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
  for (const name of names) {
    const path = resolveViewFile(root, name);
    if (path === null) continue;
    const raw = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    const spec = decodeSpec(raw);
    if (Option.isSome(spec)) views.push({ name, spec: spec.value });
  }
  return views;
});
