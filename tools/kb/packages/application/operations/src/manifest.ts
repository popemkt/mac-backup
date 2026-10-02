/**
 * `kb.manifest` — the registry's own listing, as an action.
 *
 * Listing the actions is something every surface offers, so it is an action
 * like the rest rather than a tool one surface hand-writes: MCP serves it as
 * `kb_manifest`, HTTP and the CLI invoke it by id. It reads the
 * {@link ActionCatalog} the invoke tip provides, so the listing is always the
 * registry the call runs in.
 *
 * Beside the actions it lists the view catalog (`@kb/views`' `viewCatalog`):
 * every view kb provides, with its settings as JSON Schema, which is what an
 * agent needs to write a view node (`view.propose`).
 */
import { Effect } from "effect";
import { z } from "zod";
import { ActionCatalog, ManifestEntrySchema, type ActionDefinition } from "@kb/contracts";
import { viewCatalog } from "@kb/views";

/** One view of the catalog on the wire: `@kb/views`' `ViewCatalogEntry`. */
const ViewCatalogEntrySchema = z.object({
  id: z.string(),
  option: z.string(),
  label: z.string(),
  family: z.string().optional(),
  settings: z.unknown(),
  defaults: z.unknown().optional(),
});

export const kbManifestDef = {
  id: "kb.manifest",
  title: "KB action manifest",
  description:
    "Return the full kb action registry manifest, and the view catalog: every view type with its settings as JSON Schema",
  mode: { kind: "read" } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    actions: z.array(ManifestEntrySchema),
    views: z.array(ViewCatalogEntrySchema),
  }),
} satisfies ActionDefinition;

export const kbManifestEffect = Effect.fn("kb.manifest")(function* (): Effect.fn.Return<
  z.infer<typeof kbManifestDef.outputSchema>,
  never,
  ActionCatalog
> {
  return { actions: [...(yield* ActionCatalog)], views: [...viewCatalog()] };
});
