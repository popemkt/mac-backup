/**
 * `kb.manifest` — the registry's own listing, as an action.
 *
 * Listing the actions is something every surface offers, so it is an action
 * like the rest rather than a tool one surface hand-writes: MCP serves it as
 * `kb_manifest`, HTTP and the CLI invoke it by id. It reads the
 * {@link ActionCatalog} the invoke tip provides, so the listing is always the
 * registry the call runs in.
 */
import { Effect } from "effect";
import { z } from "zod";
import { ActionCatalog, ManifestEntrySchema, type ActionDefinition } from "@kb/contracts";

export const kbManifestDef = {
  id: "kb.manifest",
  title: "KB action manifest",
  description: "Return the full kb action registry manifest",
  mode: "read" as const,
  inputSchema: z.object({}),
  outputSchema: z.object({ actions: z.array(ManifestEntrySchema) }),
} satisfies ActionDefinition;

export const kbManifestEffect = Effect.fn("kb.manifest")(function* (): Effect.fn.Return<
  z.infer<typeof kbManifestDef.outputSchema>,
  never,
  ActionCatalog
> {
  return { actions: [...(yield* ActionCatalog)] };
});
