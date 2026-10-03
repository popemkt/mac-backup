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
 *
 * It lists every action, and says of each what is decided about the caller's
 * own call to it (`decision`): the policies for the actor the call was made
 * by, else the action's mode. That is what each surface lists from
 * (`listingOf`), so a surface and the invoke core cannot disagree.
 */
import { Effect } from "effect";
import { z } from "zod";
import {
  ActionCatalog,
  CurrentCall,
  DecidedEntrySchema,
  KbCtx,
  type ActionDefinition,
} from "@kb/contracts";
import { viewCatalog } from "@kb/views";
import { decide } from "./approval.ts";

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
    "Return the full kb action registry manifest, with what is decided about your own call to each action (allow, ask for approval, deny), and the view catalog: every view type with its settings as JSON Schema",
  mode: { kind: "read" } as const,
  inputSchema: z.object({}),
  outputSchema: z.object({
    actions: z.array(DecidedEntrySchema),
    views: z.array(ViewCatalogEntrySchema),
  }),
} satisfies ActionDefinition;

export const kbManifestEffect = Effect.fn("kb.manifest")(function* (): Effect.fn.Return<
  z.infer<typeof kbManifestDef.outputSchema>,
  never,
  ActionCatalog | KbCtx
> {
  const ctx = yield* KbCtx;
  const actor = (yield* CurrentCall)?.actor;
  const actions = (yield* ActionCatalog).map((entry) => ({
    ...entry,
    decision: decide(ctx, entry, actor).decision,
  }));
  return { actions, views: [...viewCatalog()] };
});
